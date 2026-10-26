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
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { adminDb, adminAuth } from '../admin-firebase';
import { dayKey, toDate } from '../admin-utils';
import { GUIDES } from '../../booking/booking-catalog';
import type { GroupHiker } from '../../../models/booking.model';
import {
  type AttendanceMark, type AttendanceRecord, type GuideStatus, type GuideTrails, DEFAULT_GUIDE_STATUS,
  MAX_GUIDE_GUESTS, participantsOf, toAttendance, toGuideStatus, toGuideTrails,
} from '../../../models/guide-ops.model';

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
  /** Last change by TrailBound (confirmed, cancelled…), for notifications. */
  updatedAt: Date | null;
  /** The hiker's account, which attendance is filed against. */
  uid: string;
  /** Everyone on a group booking (includes the person who booked). Empty for one hiker. */
  groupHikers: GroupHiker[];
}

@Injectable({ providedIn: 'root' })
export class GuideDataService {
  private readonly _hikes = signal<GuideHike[]>([]);
  private readonly _rosterId = signal('');
  private readonly _loaded = signal(false);
  private readonly _error = signal('');
  private readonly _status = signal<GuideStatus>({ ...DEFAULT_GUIDE_STATUS });
  private readonly _attendance = signal<Record<string, AttendanceRecord>>({});
  private readonly _trails = signal<GuideTrails>(null);

  readonly hikes = this._hikes.asReadonly();
  /** This guide's availability and capacity (guide_status/{rosterId}). */
  readonly status = this._status.asReadonly();
  /** Attendance this guide has recorded, by booking id. */
  readonly attendance = this._attendance.asReadonly();
  /** Mountains TrailBound assigned this guide to (null = not restricted). Read-only here. */
  readonly trails = this._trails.asReadonly();
  /** Which roster entry this account is ('' until linked). */
  readonly rosterId = computed(() => this._rosterId());
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
  /** The availability and attendance listeners, opened alongside the hikes one. */
  private extraUnsubs: Unsubscribe[] = [];

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

    // Availability and capacity. No document yet = available, no limit.
    this.extraUnsubs.push(onSnapshot(
      doc(adminDb, 'guide_status', rosterId),
      (snap) => this._status.set(toGuideStatus(snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : undefined, toDate)),
      (err) => console.warn('[guide] availability:', err),
    ));

    // Mountains an admin assigned (guide_trails is public read, admin write).
    this.extraUnsubs.push(onSnapshot(
      doc(adminDb, 'guide_trails', rosterId),
      (snap) => this._trails.set(snap.exists() ? toGuideTrails(snap.data()) : null),
      (err) => console.warn('[guide] mountains:', err),
    ));

    // Attendance this guide has recorded. The query matches the read rule
    // (guideId == my roster id), so Firestore can allow it.
    this.extraUnsubs.push(onSnapshot(
      query(collection(adminDb, 'attendance'), where('guideId', '==', rosterId)),
      (snap) => {
        const map: Record<string, AttendanceRecord> = {};
        for (const d of snap.docs) map[d.id] = toAttendance(d.id, d.data({ serverTimestamps: 'estimate' }), toDate);
        this._attendance.set(map);
      },
      (err) => console.warn('[guide] attendance:', err),
    ));
  }

  /** Performs the stop operation for this feature and returns its result to the caller. */
  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this.extraUnsubs.forEach((u) => u());
    this.extraUnsubs = [];
    this._status.set({ ...DEFAULT_GUIDE_STATUS });
    this._attendance.set({});
    this._trails.set(null);
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

  // ── availability & capacity ──────────────────────────────────────────────

  /**
   * Saves whether this guide is taking hikes and how many hikers per date.
   * firestore.rules only accepts this from the guide whose roster id it is.
   */
  saveStatus(available: boolean, maxGuests: number | null): Promise<void> {
    const rosterId = this._rosterId();
    const uid = adminAuth.currentUser?.uid;
    if (!rosterId || !uid) return Promise.reject(new Error('Your account is not linked to a guide on the roster yet.'));
    // null = no limit, which is how every guide started.
    const max = maxGuests === null ? null : Math.round(maxGuests);
    if (max !== null && (!Number.isInteger(max) || max < 1 || max > MAX_GUIDE_GUESTS)) {
      return Promise.reject(new Error(`Maximum guests must be a whole number from 1 to ${MAX_GUIDE_GUESTS}, or left empty for no limit.`));
    }
    return setDoc(doc(adminDb, 'guide_status', rosterId), {
      available,
      maxGuests: max,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
  }

  // ── attendance ───────────────────────────────────────────────────────────

  /**
   * Records who turned up. Every participant must be marked; the whole sheet
   * is written at once so it can never be half-saved. firestore.rules only
   * accepts it from the guide this booking is assigned to, and only once the
   * booking has been confirmed.
   */
  saveAttendance(h: GuideHike, marks: Record<string, AttendanceMark>): Promise<void> {
    const rosterId = this._rosterId();
    const email = adminAuth.currentUser?.email ?? '';
    if (!rosterId) return Promise.reject(new Error('Your account is not linked to a guide on the roster yet.'));

    const people = participantsOf({ userName: h.hikerName, groupHikers: h.groupHikers });
    const entries: Record<string, { name: string; status: AttendanceMark }> = {};
    for (const p of people) {
      const mark = marks[p.key];
      if (mark !== 'present' && mark !== 'absent') {
        return Promise.reject(new Error('Mark every hiker present or absent before saving.'));
      }
      entries[p.key] = { name: p.name, status: mark };
    }

    return setDoc(doc(adminDb, 'attendance', h.id), {
      bookingId: h.id,
      uid: h.uid,
      guideId: rosterId,
      reference: h.reference,
      trailName: h.trailName,
      date: h.date,
      entries,
      recordedBy: email,
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
    updatedAt: toDate(d['updatedAt']),
    uid: String(d['uid'] ?? ''),
    groupHikers: Array.isArray(d['groupHikers'])
      ? d['groupHikers'].map((g: Record<string, unknown>) => ({
          name: String(g['name'] ?? ''),
          address: String(g['address'] ?? ''),
          emergencyContactName: String(g['emergencyContactName'] ?? ''),
          emergencyContactPhone: String(g['emergencyContactPhone'] ?? ''),
        }))
      : [],
  };
}
