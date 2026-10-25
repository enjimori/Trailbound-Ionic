/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GUIDE — data
 *
 * What a guide sees: the hikes assigned to them, and nothing else.
 *
 * The join is by roster id. booking-catalog.ts holds the roster as static code
 * — names, years, summits, and the bios and photos in guide-profiles.ts — and
 * an admin links an account to one of those entries, writing guideRosterId on
 * the user document. Every booking carries the same id in guideId. So "my
 * hikes" is a query the server can answer and a rule can check, rather than a
 * comparison of display names that breaks the day two guides share one.
 *
 * Like the permit office, this deliberately avoids AdminDataService: that
 * opens a listener on every collection, and a guide has no business reading
 * other hikers, the community feed or anybody's payment details.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Injectable, computed, signal } from '@angular/core';
import {
  type FirestoreError,
  type Unsubscribe,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { adminDb, adminAuth } from '../admin-firebase';
import { dayKey, toDate } from '../admin-utils';
import { GUIDES } from '../../booking/booking-catalog';

/** One assigned hike, with only what a guide needs at the trailhead. */
export interface GuideHike {
  id: string;
  reference: string;
  trailId: string;
  trailName: string;
  trailImage: string;
  /** Hike date, yyyy-mm-dd. */
  date: string;
  packageName: string;
  activityNames: string[];
  hikerName: string;
  hikerEmail: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  /** True once TrailBound has confirmed — before that the hike may not happen. */
  confirmed: boolean;
  createdAt: Date | null;
}

@Injectable({ providedIn: 'root' })
export class GuideDataService {
  private readonly _hikes = signal<GuideHike[]>([]);
  private readonly _rosterId = signal('');
  private readonly _loaded = signal(false);
  private readonly _error = signal('');

  readonly hikes = this._hikes.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly error = this._error.asReadonly();

  /** The guide's name from the roster, for the greeting. */
  readonly guideName = computed(
    () => GUIDES.find((g) => g.id === this._rosterId())?.name ?? '',
  );

  /** Confirmed hikes from today onwards, soonest first. */
  readonly upcoming = computed(() => {
    const today = dayKey(new Date());
    return this._hikes()
      .filter((h) => h.date >= today && h.status !== 'cancelled' && h.status !== 'completed')
      .sort((a, b) => a.date.localeCompare(b.date));
  });

  /** Everything else — done, missed, cancelled, or simply past. */
  readonly past = computed(() => {
    const today = dayKey(new Date());
    return this._hikes()
      .filter((h) => h.date < today || h.status === 'completed' || h.status === 'cancelled')
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  /** Hikes happening today — what the guide opens the app for. */
  readonly today = computed(() => {
    const key = dayKey(new Date());
    return this._hikes().filter((h) => h.date === key && h.status === 'confirmed');
  });

  private unsub: Unsubscribe | null = null;

  /**
   * Resolves which guide this account is, then listens for their hikes.
   *
   * Two steps rather than one because the roster id lives on the user document
   * and the query needs it. An account with no guideRosterId gets a clear
   * message instead of an empty screen — being unlinked is an admin oversight,
   * not an absence of work, and the two should not look the same.
   */
  async start(): Promise<void> {
    if (this.unsub) return;

    const uid = adminAuth.currentUser?.uid;
    if (!uid) {
      this._error.set('You are not signed in.');
      return;
    }

    let rosterId = '';
    try {
      rosterId = String((await getDoc(doc(adminDb, 'users', uid))).data()?.['guideRosterId'] ?? '');
    } catch {
      this._error.set('Could not read your account. Publish the latest firestore.rules.');
      return;
    }

    if (!rosterId) {
      this._error.set(
        'Your account is not linked to a guide on the roster yet, so there are no hikes to show. Ask a TrailBound admin to link it under Staff.',
      );
      this._loaded.set(true);
      return;
    }
    this._rosterId.set(rosterId);

    this.unsub = onSnapshot(
      query(collection(adminDb, 'bookings'), where('guideId', '==', rosterId)),
      (snap) => {
        this._hikes.set(snap.docs.map((d) => toHike(d.id, d.data({ serverTimestamps: 'estimate' }))));
        this._loaded.set(true);
        this._error.set('');
      },
      (err: FirestoreError) => {
        console.error('[guide] hikes:', err);
        this._error.set(
          err.code === 'permission-denied'
            ? 'Firebase refused this account access to its hikes. Publish the latest firestore.rules.'
            : err.message,
        );
      },
    );
  }

  /** Performs the stop operation for this feature and returns its result to the caller. */
  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this._hikes.set([]);
    this._rosterId.set('');
    this._loaded.set(false);
    this._error.set('');
  }

  /**
   * The hiker walked the trail. Recorded at the trailhead by the guide, who is
   * the only person actually there to know.
   */
  markCompleted(h: GuideHike): Promise<void> {
    return updateDoc(doc(adminDb, 'bookings', h.id), {
      status: 'completed',
      updatedAt: serverTimestamp(),
    });
  }

  /** The hiker never turned up. */
  markNoShow(h: GuideHike): Promise<void> {
    return updateDoc(doc(adminDb, 'bookings', h.id), {
      status: 'no_show',
      updatedAt: serverTimestamp(),
    });
  }
}

function toHike(id: string, d: Record<string, any>): GuideHike {
  const raw = String(d['status'] ?? 'confirmed');
  const status = (['pending', 'confirmed', 'completed', 'cancelled', 'no_show'].includes(raw)
    ? raw
    : 'confirmed') as GuideHike['status'];
  return {
    id,
    reference: String(d['reference'] ?? id),
    trailId: String(d['trailId'] ?? ''),
    trailName: String(d['trailName'] ?? ''),
    trailImage: String(d['trailImage'] ?? ''),
    date: String(d['date'] ?? ''),
    packageName: String(d['packageName'] ?? '—'),
    activityNames: Array.isArray(d['activityNames']) ? d['activityNames'].map(String) : [],
    hikerName: String(d['userName'] ?? ''),
    hikerEmail: String(d['userEmail'] ?? ''),
    status,
    confirmed: status === 'confirmed',
    createdAt: toDate(d['createdAt']),
  };
}
