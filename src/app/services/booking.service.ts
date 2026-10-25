/**
 * Booking state and persistence: owns the in-progress draft, computes prices,
 * creates bookings, and synchronizes the saved booking list for pages and
 * checkout.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import {
  Booking, BookingDraft, BookingQuote, GroupHiker, HikeActivity, MerchLine,
} from '../models/booking.model';
import { balanceFor, depositFor, initialPaperwork } from '../models/booking-workflow';
import { auth, db } from './firebase.client';
import { CatalogService } from './catalog.service';
import { UserService } from './user.service';
import { CertificateService } from './certificate.service';
import { RiskAckService } from './risk-ack.service';
import { permitFeeFor, permitFor } from '../pages/explore/trail-permits';
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
 *   the BOOKINGS  persisted to localStorage. Real, and tracked.
 *
 * ── PAYING IS NO LONGER CONFIRMING ────────────────────────────────────────
 * A new booking starts at status 'pending'. The hiker pays a DEPOSIT, which
 * holds the date; the balance falls due once the permit is released, and only
 * an admin moves the booking to 'confirmed'. The three status fields
 * (status / paperwork / payment) move independently — see booking-workflow.ts
 * for why one field could not express this.
 *
 * ADMIN PANEL HOOK-UP
 *   Each booking is ALSO copied to Firestore  bookings/{id}  with the hiker's
 *   uid, name and email, so the admin panel can see every booking. When a
 *   hiker signs in, their bookings are read back from Firestore, so a status
 *   an admin changed shows here too, and a booking made on another phone
 *   appears. The Bookings tab only lists the signed-in hiker's own bookings
 *   (plus older ones saved before this change).
 * ═══════════════════════════════════════════════════════════════════════════
 */

const STORAGE_KEY = 'TrailBound.bookings.v1';

@Injectable({ providedIn: 'root' })
export class BookingService {
  private readonly catalog = inject(CatalogService);
  private readonly userService = inject(UserService);
  private readonly certs = inject(CertificateService);
  private readonly riskAck = inject(RiskAckService);
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
    // Keep the booking owner current and merge server bookings after sign-in.
    onAuthStateChanged(auth, user => {
      this._uid.set(user?.uid ?? null);
      if (user) void this.syncFromServer(user.uid);
    });
  }

  // ── draft ───────────────────────────────────────────────────────────────

  /** Hands the current selection from the booking page to checkout. */
  setDraft(draft: BookingDraft) {
    this._draft.set(draft);
  }

  /** Prevents a confirmed or abandoned booking from being reused at checkout. */
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
    const pkg = this.catalog.packages().find((item) => item.id === draft.packageId)
      ?? packageById(draft.packageId);

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
        const item = this.catalog.merch().find((merch) => merch.id === id) ?? merchById(id);
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
    const groupSize = pkg.id === 'group' ? (draft.groupHikers?.length ?? 0) : 0;
    const groupSurcharge = groupSize > 20
      ? (10 * 1200) + ((groupSize - 20) * 1500)
      : Math.max(0, groupSize - 10) * 1200;
    const subtotal = pkg.price + activitiesTotal + merchTotal + groupSurcharge;
    const total = subtotal + TRANSACTION_FEE;

    // Carved out of the total, not added to it. The package already covers
    // barangay registration, the environmental fee and the trail fee, so
    // adding the permit fee on top would charge the hiker twice for it.
    const deposit = depositFor(permitFeeFor(draft.trailName), TRANSACTION_FEE);

    return {
      packageName: pkg.name,
      packagePrice: pkg.price,
      coveredActivities: covered.map(a => ({ id: a.id, name: a.name })),
      paidActivities: paid.map(a => ({ id: a.id, name: a.name, price: a.price })),
      merchLines,
      activitiesTotal,
      merchTotal,
      groupSurcharge,
      subtotal,
      transactionFee: TRANSACTION_FEE,
      total,
      deposit,
      balance: balanceFor(total, deposit),
    };
  }

  // ── creating ────────────────────────────────────────────────────────────

  /**
   * Writes the booking and returns it. The caller navigates to the
   * confirmation screen with the returned id.
   *
   * The booking starts PENDING, not confirmed: the deposit holds the date,
   * and an admin confirms once the documents, the permit, the guide and the
   * balance are all settled.
   *
   * `cardLast4` is the ONLY thing kept from the payment form. The full number,
   * expiry and CVV are never passed in here and never stored.
   */
  confirm(draft: BookingDraft, paymentMethod: string, cardLast4: string | null): Booking {
    const q = this.quote(draft);
    const pkg = this.catalog.packages().find((item) => item.id === draft.packageId)
      ?? packageById(draft.packageId);
    const guide = guideById(draft.guideId);
    const permit = permitFor(draft.trailName);

    // Where the paperwork starts depends on what this trail asks for and what
    // the hiker already has on file.
    const medical = this.certs.records()['medical']?.status ?? 'none';
    const ack = this.riskAck.ackFor(draft.trailId);

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
      groupHikers: pkg.id === 'group'
        ? (draft.groupHikers ?? []).map((hiker): GroupHiker => ({ ...hiker }))
        : [],
      groupSurcharge: q.groupSurcharge,
      total: q.total,
      paymentMethod,
      cardLast4,
      createdAt: new Date().toISOString(),

      status: 'pending',
      paperwork: initialPaperwork(permit.requiresMedical, medical),
      payment: 'deposit_paid',
      deposit: q.deposit,
      balanceDueBy: null,

      // Filled in by an admin once the office answers.
      permitRef: null,
      permitIssuedAt: null,
      permitOffice: permit.authority === 'none' ? null : permit.office,
      permitFeeLodged: 0,

      // The record of what the hiker agreed to, and which wording they saw.
      riskAckAt: ack ? ack.at.toISOString() : null,
      riskAckVersion: ack?.version ?? null,

      uid: user?.uid,
      userName: this.userService.profile().name || user?.displayName || '',
      userEmail: user?.email ?? '',
    };

    this._bookings.update(list => [booking, ...list]);
    this.save();
    this.clearDraft();
    // The acknowledgment belonged to this booking. The next one asks again,
    // against whatever the wording says then.
    this.riskAck.clear(draft.trailId);
    void this.upload(booking);

    return booking;
  }

  /** Looks up one booking by its local or Firestore document id. */
  byId(id: string): Booking | undefined {
    return this._bookings().find(b => b.id === id);
  }

  /** Returns bookings for a trail, used by trail-specific booking views. */
  forTrail(trailId: string): Booking[] {
    return this._bookings().filter(b => b.trailId === trailId);
  }

  /** Whether Firestore has a demo-only balance marker for this booking. */
  hasDemoBalancePayment(id: string): boolean {
    return this.bookings().find((booking) => booking.id === id)?.demoBalancePaid === true;
  }

  /**
   * Saves a demo-only marker to the user's booking so the admin can see it.
   * The real payment status remains unchanged; this is not money received.
   */
  async simulateDemoBalancePayment(id: string, method: string): Promise<boolean> {
    const booking = this.bookings().find(b => b.id === id);
    const allowedMethods = ['Card', 'QRPh', 'Apple Pay', 'Maya'];
    if (
      !booking ||
      !booking.uid ||
      booking.uid !== auth.currentUser?.uid ||
      booking.paperwork !== 'cleared' ||
      booking.payment !== 'balance_due' ||
      booking.status !== 'pending' ||
      this.hasDemoBalancePayment(id) ||
      !allowedMethods.includes(method)
    ) {
      return false;
    }

    await updateDoc(doc(db, 'bookings', id), {
      demoBalancePaid: true,
      demoBalancePaidAt: serverTimestamp(),
      demoBalancePaymentMethod: method,
    });
    this._bookings.update((bookings) => bookings.map((item) =>
      item.id === id
        ? {
            ...item,
            demoBalancePaid: true,
            demoBalancePaidAt: new Date().toISOString(),
            demoBalancePaymentMethod: method,
          }
        : item,
    ));
    this.save();
    return true;
  }

  /** Refreshes server changes when the hiker returns to their booking history. */
  refreshForCurrentUser(): Promise<void> {
    const uid = auth.currentUser?.uid;
    return uid ? this.syncFromServer(uid) : Promise.resolve();
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

  /** Persists the current changes through the owning service and updates saved state. */
  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._bookings()));
    } catch {
      // Storage unavailable — bookings stay for this session only.
    }
  }
}