import { Injectable, computed, inject, signal } from '@angular/core';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import {
  Booking, BookingDraft, BookingQuote, HikeActivity, MerchLine,
} from '../models/booking.model';
import { auth, db } from './firebase.client';
import { UserService } from './user.service';
import {
  TRANSACTION_FEE, activityById, guideById, merchById, packageById,
} from '../pages/booking/booking-catalog';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BOOKING SERVICE
 *
 * Two separate things live here, and the difference matters:
 *
 *   the DRAFT     in memory only. What the hiker is picking right now, carried
 *                 from the booking page to checkout. If they close the app
 *                 mid-flow it is gone, which is correct — an abandoned basket
 *                 should not come back to life a week later.
 *
 *   the BOOKINGS  persisted to localStorage. Confirmed, paid, real.
 *
 * When the team wires up Firestore, only `load()` and `save()` change — every
 * page reads through the signals below.
 *
 * ADMIN PANEL HOOK-UP
 *   Each confirmed booking is ALSO copied to Firestore  bookings/{id}  with the
 *   hiker's uid, name and email, so the admin panel can see every booking.
 *   When a hiker signs in, their bookings are read back from Firestore, so a
 *   booking an admin cancels or completes shows that status here too, and a
 *   booking made on another phone appears. The Bookings tab only lists the
 *   signed-in hiker's own bookings (plus older ones saved before this change).
 * ═══════════════════════════════════════════════════════════════════════════
 */

const STORAGE_KEY = 'TrailBound.bookings.v1';

@Injectable({ providedIn: 'root' })
export class BookingService {
  private readonly userService = inject(UserService);
  private readonly _draft = signal<BookingDraft | null>(null);
  private readonly _bookings = signal<Booking[]>(this.load());
  private readonly _uid = signal<string | null>(null);

  readonly draft = computed(() => this._draft());
  /** The signed-in hiker's bookings, plus any saved before bookings had an owner. */
  readonly bookings = computed(() => {
    const uid = this._uid();
    return this._bookings().filter(b => !b.uid || b.uid === uid);
  });

  constructor() {
    onAuthStateChanged(auth, user => {
      this._uid.set(user?.uid ?? null);
      if (user) void this.syncFromServer(user.uid);
    });
  }

  // ── draft ───────────────────────────────────────────────────────────────

  setDraft(draft: BookingDraft) {
    this._draft.set(draft);
  }

  clearDraft() {
    this._draft.set(null);
  }

  // ── pricing ─────────────────────────────────────────────────────────────

  /**
   * Turns a draft into a priced breakdown.
   *
   * The one subtle rule: a package that includes an activity covers the most
   * expensive eligible one the hiker picked. If you book Day Hike + Activity
   * and tick both the waterfall (₱350) and tree planting (₱250), the waterfall
   * is the covered one and you pay ₱250 for the other — not the reverse. The
   * hiker should get the better half of an ambiguity they did not create.
   */
  quote(draft: BookingDraft): BookingQuote {
    const pkg = packageById(draft.packageId);

    const selected = draft.activityIds
      .map(id => activityById(id))
      .filter((a): a is HikeActivity => !!a);

    const covered = selected
      .filter(a => pkg.coversActivityIds.includes(a.id))
      .sort((a, b) => b.price - a.price)
      .slice(0, pkg.includedActivities);

    const coveredIds = new Set(covered.map(a => a.id));
    const paid = selected.filter(a => !coveredIds.has(a.id));

    const merchLines: MerchLine[] = Object.entries(draft.merch)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => {
        const item = merchById(id);
        if (!item) return null;
        return {
          id: item.id,
          name: item.name,
          qty,
          unitPrice: item.price,
          lineTotal: item.price * qty,
        };
      })
      .filter((l): l is MerchLine => !!l);

    const activitiesTotal = paid.reduce((sum, a) => sum + a.price, 0);
    const merchTotal = merchLines.reduce((sum, l) => sum + l.lineTotal, 0);
    const subtotal = pkg.price + activitiesTotal + merchTotal;

    return {
      packageName: pkg.name,
      packagePrice: pkg.price,
      coveredActivities: covered.map(a => ({ id: a.id, name: a.name })),
      paidActivities: paid.map(a => ({ id: a.id, name: a.name, price: a.price })),
      merchLines,
      activitiesTotal,
      merchTotal,
      subtotal,
      transactionFee: TRANSACTION_FEE,
      total: subtotal + TRANSACTION_FEE,
    };
  }

  // ── confirming ──────────────────────────────────────────────────────────

  /**
   * Writes the booking and returns it. The caller navigates to the
   * confirmation screen with the returned id.
   *
   * `cardLast4` is the ONLY thing kept from the payment form. The full number,
   * expiry and CVV are never passed in here and never stored.
   */
  confirm(draft: BookingDraft, paymentMethod: string, cardLast4: string | null): Booking {
    const q = this.quote(draft);
    const pkg = packageById(draft.packageId);
    const guide = guideById(draft.guideId);

    const user = auth.currentUser;
    const booking: Booking = {
      id: 'b' + Date.now(),
      reference: this.newReference(),
      trailId: draft.trailId,
      trailName: draft.trailName,
      trailImage: draft.trailImage,
      date: draft.date,
      packageId: draft.packageId,
      packageName: pkg.name,
      activityNames: [
        ...q.coveredActivities.map(a => a.name),
        ...q.paidActivities.map(a => a.name),
      ],
      guideName: guide?.name ?? null,
      merch: q.merchLines,
      total: q.total,
      paymentMethod,
      cardLast4,
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      uid: user?.uid,
      userName: this.userService.profile().name || user?.displayName || '',
      userEmail: user?.email ?? '',
    };

    this._bookings.update(list => [booking, ...list]);
    this.save();
    this.clearDraft();
    void this.upload(booking);

    return booking;
  }

  byId(id: string): Booking | undefined {
    return this._bookings().find(b => b.id === id);
  }

  forTrail(trailId: string): Booking[] {
    return this._bookings().filter(b => b.trailId === trailId);
  }

  /**
   * Five digits, prefixed. Random rather than sequential so one booking code
   * does not reveal how many bookings the app has taken.
   */
  private newReference(): string {
    return 'HIK-' + String(Math.floor(10000 + Math.random() * 90000));
  }

  // ── Firestore copy (for the admin panel) ────────────────────────────────

  /** Copies one booking to bookings/{id}. A failure keeps it local and retries on next sign-in. */
  private async upload(booking: Booking): Promise<void> {
    if (!booking.uid) return;
    try {
      // JSON round-trip drops `undefined` fields, which Firestore refuses.
      const { synced, ...data } = JSON.parse(JSON.stringify(booking)) as Booking;
      void synced;
      await setDoc(doc(db, 'bookings', booking.id), data);
      this._bookings.update(list => list.map(b => (b.id === booking.id ? { ...b, synced: true } : b)));
      this.save();
    } catch (e) {
      console.warn('Booking saved on this device only; will retry later.', e);
    }
  }

  /**
   * Brings this hiker's bookings in line with Firestore: picks up status
   * changes an admin made, drops bookings an admin deleted, adds bookings
   * made on another device, and re-sends any that never reached the server.
   */
  private async syncFromServer(uid: string): Promise<void> {
    let remote: Booking[];
    try {
      const snap = await getDocs(query(collection(db, 'bookings'), where('uid', '==', uid)));
      remote = snap.docs.map(d => ({ ...(d.data() as Booking), id: d.id, synced: true }));
    } catch (e) {
      console.warn('Could not read bookings from Firestore.', e);
      return;
    }

    const byId = new Map(remote.map(b => [b.id, b]));
    const retry: Booking[] = [];
    const merged: Booking[] = [];

    for (const local of this._bookings()) {
      if (local.uid !== uid) {
        merged.push(local);
        continue;
      }
      const server = byId.get(local.id);
      if (server) {
        merged.push({ ...local, ...server, trailImage: server.trailImage || local.trailImage });
        byId.delete(local.id);
      } else if (!local.synced) {
        merged.push(local);
        retry.push(local);
      }
      // else: it reached the server once and is gone now — an admin deleted it.
    }
    merged.push(...byId.values());
    merged.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

    this._bookings.set(merged);
    this.save();
    retry.forEach(b => void this.upload(b));
  }

  // ── persistence ─────────────────────────────────────────────────────────

  /**
   * localStorage throws in private browsing and when site data is blocked, so
   * both ends are wrapped. A failed read costs the booking history, not the
   * page.
   */
  private load(): Booking[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._bookings()));
    } catch {
      // Storage unavailable — bookings stay for this session only.
    }
  }
}
