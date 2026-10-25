/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADMIN DATA — everything the panel can see and change, live from Firestore
 *
 *   users/{uid}          hiker accounts: profile, saved trails, role, status
 *   bookings/{id}        every booking, with who made it and where it stands
 *   posts/{id}           community posts (+ comments, edit history)
 *   profiles/{uid}       public name + photo shown on posts
 *   reviews/{id}         trail reviews
 *   trail_status/{id}    trails an admin has closed, and why
 *   certificates/{id}    hikers' medical certificates (the files are in
 *                        certificate_files)
 *
 * Every collection streams with onSnapshot, so a booking made on a phone
 * appears on the dashboard without a refresh. Reads and writes use the shared
 * Firebase app and signed-in session (admin-firebase.ts); Firestore rules
 * authorize the session based on its admin account or users/{uid}.role.
 *
 * The 30 trails, packages, guides and merchandise are NOT in Firestore —
 * they live in code (explore-trails.data.ts, booking-catalog.ts) — so the
 * panel reads those straight from the same files the hiker app uses.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  type FirestoreError,
  type Unsubscribe,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { adminDb } from './admin-firebase';
import { dayKey, toDate } from './admin-utils';
import type { GroupHiker, MerchLine } from '../../models/booking.model';
import {
  BALANCE_WINDOW_DAYS,
  type PaperworkStatus,
  type PaymentStatus,
} from '../../models/booking-workflow';
import { trailById } from '../explore/trail-lookup';
import { TrailService } from '../../services/trail.service';
import type { CertificateRecord, CertificateStatus, CertificateType } from '../../models/certificate.model';

// ── Shapes the screens use ─────────────────────────────────────────────────

export interface SavedTrail {
  id: string;
  trailId: string;
  name: string;
  image: string;
  date: string;
  duration: string;
}

/**
 * Staff roles alongside 'hiker'.
 *
 * 'permit_office' is the issuing body — a barangay, a municipal tourism
 * office, a DENR protected-area office. One account covers all of them for
 * now; when a second office is added, match their `office` field against the
 * booking's permitOffice so each only sees its own applications.
 */
export type UserRole = 'admin' | 'permit_office' | 'guide' | 'hiker';

export interface AdminUser {
  uid: string;
  name: string;
  email: string;
  phone: string;
  avatar: string;
  location: string;
  bio: string;
  dob: string;
  gender: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  role: UserRole;
  /** Which issuing body a permit officer belongs to. Empty for everyone else. */
  office: string;
  /**
   * Which guide on the roster this account IS, by id ('g1'…).
   *
   * The roster in booking-catalog.ts is static code with the photos and bios,
   * and accounts live in Firebase — this field is the join between them. A
   * booking stores the same roster id, so a guide's own hikes are a query
   * rather than a name comparison that breaks the day two guides share one.
   */
  guideRosterId: string;
  status: 'active' | 'suspended';
  createdAt: Date | null;
  upcoming: SavedTrail[];
}

/**
 * Where the trip stands. 'pending' is where a new booking starts: paying the
 * deposit holds the date, it does not confirm the hike.
 */
export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export interface AdminBooking {
  id: string;
  reference: string;
  trailId: string;
  trailName: string;
  trailImage: string;
  /** Hike date, yyyy-mm-dd. */
  date: string;
  packageId: string;
  packageName: string;
  activityNames: string[];
  guideName: string | null;
  /** The roster id behind that name, which is what a guide account matches on. */
  guideId: string | null;
  merch: MerchLine[];
  groupHikers: GroupHiker[];
  groupSurcharge: number;
  total: number;
  paymentMethod: string;
  cardLast4: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  /** What is stored. */
  status: BookingStatus;

  /** Where the documents and permit stand. */
  paperwork: PaperworkStatus;
  /** Where the money stands. */
  payment: PaymentStatus;
  /** Taken at checkout. The rest is the balance. */
  deposit: number;
  balanceDueBy: Date | null;

  /** What the issuing office granted. */
  permitRef: string | null;
  permitIssuedAt: Date | null;
  permitOffice: string | null;
  /** Demo-only balance simulation; not a record of money received. */
  demoBalancePaid: boolean;
  demoBalancePaidAt: Date | null;
  demoBalancePaymentMethod: string | null;
  /** The part of the permit fee the office keeps even if the hike is refused. */
  permitFeeLodged: number;
  /** True once an application has been sent, which is what a permit officer sees. */
  permitLodged: boolean;

  /** When the hiker accepted the risk sheet, and which wording. */
  riskAckAt: Date | null;
  riskAckVersion: string;

  uid: string;
  userName: string;
  userEmail: string;
}

export interface AdminPost {
  id: string;
  authorUid: string;
  authorName: string;
  avatar: string;
  text: string;
  images: string[];
  trailId: string;
  trailName: string;
  rating: number;
  upvotes: number;
  downvotes: number;
  commentCount: number;
  repostOf: string | null;
  createdAt: Date | null;
  edited: boolean;
}

export interface AdminComment {
  id: string;
  authorUid: string;
  authorName: string;
  avatar: string;
  text: string;
  createdAt: Date | null;
}

export interface AdminReview {
  id: string;
  trailId: string;
  trailName: string;
  uid: string;
  author: string;
  rating: number;
  text: string;
  createdAt: Date | null;
}

export interface TrailState {
  status: 'open' | 'closed';
  note: string;
  updatedAt: Date | null;
}

export type CollectionName =
  | 'users' | 'bookings' | 'posts' | 'profiles' | 'reviews' | 'trail_status' | 'certificates';

export type AdminCertificate = CertificateRecord;

/**
 * Booking status as a person reads it: a confirmed hike in the past is done.
 *
 * A PENDING booking whose date has passed stays pending, deliberately. It did
 * not happen — nobody confirmed it — and quietly relabelling it "completed"
 * would hide a booking that someone still owes an answer on.
 */
export function effectiveStatus(b: AdminBooking): BookingStatus {
  if (b.status === 'cancelled' || b.status === 'completed' || b.status === 'no_show') return b.status;
  if (b.status === 'pending') return 'pending';
  return b.date && b.date < dayKey(new Date()) ? 'completed' : 'confirmed';
}

/** Cancelled bookings earn nothing. */
export function countsAsRevenue(b: AdminBooking): boolean {
  return b.status !== 'cancelled' && b.status !== 'no_show';
}

/**
 * What has actually been received, which is not the same as the total. A
 * pending booking has paid a deposit only; counting its full price as revenue
 * would overstate the books by whatever has not been collected yet.
 */
export function receivedFrom(b: AdminBooking): number {
  if (!countsAsRevenue(b)) return 0;
  return b.payment === 'paid_in_full' ? b.total : b.deposit;
}

@Injectable({ providedIn: 'root' })
export class AdminDataService {
  private readonly trailService = inject(TrailService);

  private readonly _users = signal<AdminUser[]>([]);
  private readonly _bookings = signal<AdminBooking[]>([]);
  private readonly _posts = signal<AdminPost[]>([]);
  private readonly _profiles = signal<Record<string, { name: string; avatar: string }>>({});
  private readonly _reviews = signal<AdminReview[]>([]);
  private readonly _trailStatus = signal<Record<string, TrailState>>({});
  private readonly _certificates = signal<AdminCertificate[]>([]);

  private readonly _loaded = signal<Partial<Record<CollectionName, boolean>>>({});
  private readonly _errors = signal<Partial<Record<CollectionName, string>>>({});

  readonly users = this._users.asReadonly();
  readonly bookings = this._bookings.asReadonly();
  readonly reviews = this._reviews.asReadonly();
  readonly trailStatus = this._trailStatus.asReadonly();
  readonly certificates = this._certificates.asReadonly();
  readonly pendingCertificates = computed(() => this._certificates().filter((c) => c.status === 'pending').length);
  readonly errors = this._errors.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /** Bookings waiting on someone — the admin sidebar's count. */
  readonly pendingBookings = computed(
    () => this._bookings().filter((b) => b.status === 'pending').length,
  );

  /** Posts with the author's live name and photo filled in. */
  readonly posts = computed(() => {
    const profiles = this._profiles();
    return this._posts().map((p) => {
      const prof = profiles[p.authorUid];
      return prof ? { ...p, authorName: prof.name || p.authorName, avatar: prof.avatar || '' } : p;
    });
  });

  /** True once the main collections have answered at least once. */
  readonly ready = computed(() => {
    const l = this._loaded();
    const e = this._errors();
    return (['users', 'bookings', 'posts'] as CollectionName[]).every((c) => l[c] || e[c]);
  });

  /** A short list of collections the rules refused, for the warning banner. */
  readonly blocked = computed(() =>
    Object.entries(this._errors())
      .filter(([, msg]) => !!msg)
      .map(([name]) => name as CollectionName),
  );

  /** Hikers only — staff accounts are listed separately. */
  readonly hikers = computed(() => this._users().filter((u) => u.role === 'hiker'));

  /** Everyone with a staff role. */
  readonly staff = computed(() => this._users().filter((u) => u.role !== 'hiker'));

  private unsubs: Unsubscribe[] = [];

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** Starts the live listeners. Safe to call more than once. */
  start(): void {
    if (this.unsubs.length) return;

    this.listen('users', collection(adminDb, 'users'), (docs) =>
      this._users.set(docs.map(({ id, data }) => toUser(id, data))),
    );

    this.listen('bookings', collection(adminDb, 'bookings'), (docs) =>
      this._bookings.set(
        docs
          .map(({ id, data }) => this.toBooking(id, data))
          .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
      ),
    );

    this.listen(
      'posts',
      query(collection(adminDb, 'posts'), orderBy('createdAt', 'desc'), limit(300)),
      (docs) => this._posts.set(docs.map(({ id, data }) => toPost(id, data))),
    );

    this.listen('profiles', collection(adminDb, 'profiles'), (docs) => {
      const map: Record<string, { name: string; avatar: string }> = {};
      for (const { id, data } of docs) {
        map[id] = { name: String(data['name'] ?? ''), avatar: String(data['avatar'] ?? '') };
      }
      this._profiles.set(map);
    });

    this.listen('reviews', collection(adminDb, 'reviews'), (docs) =>
      this._reviews.set(
        docs
          .map(({ id, data }) => this.toReview(id, data))
          .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
      ),
    );

    this.listen('trail_status', collection(adminDb, 'trail_status'), (docs) => {
      const map: Record<string, TrailState> = {};
      for (const { id, data } of docs) {
        map[id] = {
          status: data['status'] === 'closed' ? 'closed' : 'open',
          note: String(data['note'] ?? ''),
          updatedAt: toDate(data['updatedAt']),
        };
      }
      this._trailStatus.set(map);
    });

    this.listen('certificates', collection(adminDb, 'certificates'), (docs) =>
      this._certificates.set(
        docs
          .filter(({ data }) => data['type'] === 'medical')
          .map(({ id, data }) => toCertificate(id, data))
          .sort((a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0)),
      ),
    );
  }

  /** Stops every listener and forgets the data (on sign-out). */
  stop(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this._users.set([]);
    this._bookings.set([]);
    this._posts.set([]);
    this._profiles.set({});
    this._reviews.set([]);
    this._trailStatus.set({});
    this._certificates.set([]);
    this._loaded.set({});
    this._errors.set({});
  }

  private listen(
    name: CollectionName,
    ref: Parameters<typeof onSnapshot>[0],
    apply: (docs: { id: string; data: Record<string, any> }[]) => void,
  ): void {
    const unsub = onSnapshot(
      ref as any,
      (snap: any) => {
        apply(
          snap.docs.map((d: any) => ({
            id: d.id,
            data: d.data({ serverTimestamps: 'estimate' }) as Record<string, any>,
          })),
        );
        this._loaded.update((l) => ({ ...l, [name]: true }));
        this._errors.update((e) => ({ ...e, [name]: '' }));
      },
      (err: FirestoreError) => {
        console.error(`[admin] ${name}:`, err);
        this._errors.update((e) => ({
          ...e,
          [name]: err.code === 'permission-denied' ? 'permission-denied' : err.message,
        }));
      },
    );
    this.unsubs.push(unsub);
  }

  // ── lookups ──────────────────────────────────────────────────────────────

  userById(uid: string): AdminUser | undefined {
    return this._users().find((u) => u.uid === uid);
  }

  /** Name for any trail id: the 30 Explore trails or the 6 seeded ones. */
  trailName(id: string): string {
    return trailById(id)?.name ?? this.trailService.getById(id)?.name ?? id;
  }

  /** Performs the trail image operation for this feature and returns its result to the caller. */
  trailImage(id: string): string {
    return trailById(id)?.image ?? this.trailService.getById(id)?.image ?? '';
  }

  /** Checks whether the trail is closed based on the admin trail data. */
  isClosed(trailId: string): boolean {
    return this._trailStatus()[trailId]?.status === 'closed';
  }

  readonly closedCount = computed(
    () => Object.values(this._trailStatus()).filter((state) => state.status === 'closed').length,
  );

  // ── bookings ─────────────────────────────────────────────────────────────

  setBookingStatus(id: string, status: BookingStatus): Promise<void> {
    return updateDoc(doc(adminDb, 'bookings', id), { status, updatedAt: serverTimestamp() });
  }

  /** Moves the documents-and-permit track on its own. */
  setPaperwork(id: string, paperwork: PaperworkStatus): Promise<void> {
    return updateDoc(doc(adminDb, 'bookings', id), { paperwork, updatedAt: serverTimestamp() });
  }

  /**
   * Sends the application to the issuing office.
   *
   * permitLodged is what a permit officer's account can query on, so this is
   * also the moment the booking becomes visible to them — nothing before it
   * was sent, which is the scoping the rules rely on.
   */
  lodgePermit(id: string, office: string): Promise<void> {
    return updateDoc(doc(adminDb, 'bookings', id), {
      permitOffice: office,
      permitLodged: true,
      paperwork: 'permit_pending' satisfies PaperworkStatus,
      updatedAt: serverTimestamp(),
    });
  }

  /**
   * Records what the office issued, and starts the balance clock.
   *
   * The permit clearing is what makes the rest of the money payable, so these
   * two writes belong together: a cleared permit with no balance due would
   * leave the booking stuck with nothing to do next.
   */
  recordPermit(id: string, permitRef: string, office: string): Promise<void> {
    const due = new Date();
    due.setDate(due.getDate() + BALANCE_WINDOW_DAYS);
    return updateDoc(doc(adminDb, 'bookings', id), {
      permitRef: permitRef.trim().slice(0, 60),
      permitIssuedAt: serverTimestamp(),
      permitOffice: office,
      permitLodged: true,
      paperwork: 'cleared' satisfies PaperworkStatus,
      payment: 'balance_due' satisfies PaymentStatus,
      balanceDueBy: due.toISOString(),
      updatedAt: serverTimestamp(),
    });
  }

  /** The office refused it. The booking cannot go ahead. */
  denyPermit(id: string): Promise<void> {
    return updateDoc(doc(adminDb, 'bookings', id), {
      paperwork: 'denied' satisfies PaperworkStatus,
      updatedAt: serverTimestamp(),
    });
  }

  /** Performs the delete booking operation for this feature and returns its result to the caller. */
  deleteBooking(id: string): Promise<void> {
    return deleteDoc(doc(adminDb, 'bookings', id));
  }

  // ── users ────────────────────────────────────────────────────────────────

  setUserStatus(uid: string, status: 'active' | 'suspended'): Promise<void> {
    return updateDoc(doc(adminDb, 'users', uid), { status });
  }

  /**
   * Grants or removes a staff role.
   *
   * 'hiker' deletes the field rather than writing the word, so an ordinary
   * account has no role at all — which is what the sign-up rule in
   * firestore.rules expects and what every older document already looks like.
   *
   * `detail` is what the role needs alongside it: the office name for a permit
   * officer, the roster id for a guide. Whichever one does not apply is
   * deleted, so an account demoted from officer to guide cannot keep claiming
   * an office it no longer speaks for.
   */
  setUserRole(uid: string, role: UserRole, detail = ''): Promise<void> {
    return updateDoc(doc(adminDb, 'users', uid), {
      role: role === 'hiker' ? deleteField() : role,
      office: role === 'permit_office' ? detail : deleteField(),
      guideRosterId: role === 'guide' ? detail : deleteField(),
    });
  }

  /**
   * Removes the profile document and public profile. The Firebase
   * Authentication login itself can only be deleted from the Firebase
   * console (that needs server-side access a browser does not have).
   */
  async deleteUserData(uid: string): Promise<void> {
    const batch = writeBatch(adminDb);
    batch.delete(doc(adminDb, 'users', uid));
    batch.delete(doc(adminDb, 'profiles', uid));
    // Their hiking documents go too. Without these the medical certificate
    // outlives the account with no owner left to claim it — a retention
    // problem under the Data Privacy Act, and the one category of data in
    // this app where that matters most. Deleting a document that does not
    // exist is a no-op in a batch, so this is safe for every hiker.
    for (const type of ['medical'] as const) {
      batch.delete(doc(adminDb, 'certificates', `${uid}_${type}`));
      batch.delete(doc(adminDb, 'certificate_files', `${uid}_${type}`));
    }
    await batch.commit();
  }

  // ── community ────────────────────────────────────────────────────────────

  async commentsFor(postId: string): Promise<AdminComment[]> {
    const snap = await getDocs(
      query(collection(adminDb, 'posts', postId, 'comments'), orderBy('createdAt', 'asc')),
    );
    const profiles = this._profiles();
    return snap.docs.map((d) => {
      const data = d.data({ serverTimestamps: 'estimate' }) as Record<string, any>;
      const uid = String(data['authorUid'] ?? '');
      const prof = profiles[uid];
      return {
        id: d.id,
        authorUid: uid,
        authorName: prof?.name || String(data['authorName'] ?? 'Trail Hiker'),
        avatar: prof?.avatar || '',
        text: String(data['text'] ?? ''),
        createdAt: toDate(data['createdAt']),
      };
    });
  }

  /** Performs the delete comment operation for this feature and returns its result to the caller. */
  async deleteComment(postId: string, commentId: string): Promise<void> {
    const batch = writeBatch(adminDb);
    batch.delete(doc(adminDb, 'posts', postId, 'comments', commentId));
    batch.update(doc(adminDb, 'posts', postId), { commentCount: increment(-1) });
    await batch.commit();
  }

  /** Deletes a post with its comments and edit history, like the app does. */
  async deletePost(postId: string): Promise<void> {
    const [comments, history] = await Promise.all([
      getDocs(collection(adminDb, 'posts', postId, 'comments')),
      getDocs(collection(adminDb, 'posts', postId, 'history')),
    ]);
    const refs = [...comments.docs, ...history.docs].map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 450) {
      const batch = writeBatch(adminDb);
      refs.slice(i, i + 450).forEach((r) => batch.delete(r));
      await batch.commit();
    }
    await deleteDoc(doc(adminDb, 'posts', postId));
  }

  // ── reviews ──────────────────────────────────────────────────────────────

  deleteReview(id: string): Promise<void> {
    return deleteDoc(doc(adminDb, 'reviews', id));
  }

  // ── trails ───────────────────────────────────────────────────────────────

  setTrailStatus(trailId: string, status: 'open' | 'closed', note = ''): Promise<void> {
    return setDoc(doc(adminDb, 'trail_status', trailId), {
      status,
      note: status === 'closed' ? note.trim().slice(0, 200) : '',
      updatedAt: serverTimestamp(),
    });
  }

  // ── certificates ─────────────────────────────────────────────────────────

  /** The uploaded file as a data URL. */
  async certificateFile(id: string): Promise<string> {
    const snap = await getDoc(doc(adminDb, 'certificate_files', id));
    const data = String(snap.data()?.['data'] ?? '');
    if (!data) throw new Error('missing-file');
    return data;
  }

  /** Performs the review certificate operation for this feature and returns its result to the caller. */
  reviewCertificate(id: string, status: CertificateStatus, note: string, reviewer: string): Promise<void> {
    return updateDoc(doc(adminDb, 'certificates', id), {
      status,
      note: status === 'rejected' ? note.trim().slice(0, 300) : '',
      reviewedAt: serverTimestamp(),
      reviewedBy: reviewer,
    });
  }

  /** Performs the delete certificate operation for this feature and returns its result to the caller. */
  async deleteCertificate(id: string): Promise<void> {
    const batch = writeBatch(adminDb);
    batch.delete(doc(adminDb, 'certificates', id));
    batch.delete(doc(adminDb, 'certificate_files', id));
    await batch.commit();
  }

  /** Performs the certificates for operation for this feature and returns its result to the caller. */
  certificatesFor(uid: string): Partial<Record<CertificateType, AdminCertificate>> {
    const out: Partial<Record<CertificateType, AdminCertificate>> = {};
    for (const c of this._certificates()) if (c.uid === uid) out[c.type] = c;
    return out;
  }

  // ── converters ───────────────────────────────────────────────────────────

  private toBooking(id: string, d: Record<string, any>): AdminBooking {
    const trailId = String(d['trailId'] ?? '');
    const total = Number(d['total'] ?? 0) || 0;

    // Bookings written before the workflow existed have none of these fields.
    // They were created as paid-and-confirmed, so that is what they read back
    // as — re-opening settled history would be worse than the inconsistency.
    const status = String(d['status'] ?? '');
    const paperwork = String(d['paperwork'] ?? '');
    const payment = String(d['payment'] ?? '');

    return {
      id,
      reference: String(d['reference'] ?? id),
      trailId,
      trailName: String(d['trailName'] || this.trailName(trailId)),
      trailImage: String(d['trailImage'] || this.trailImage(trailId)),
      date: String(d['date'] ?? ''),
      packageId: String(d['packageId'] ?? ''),
      packageName: String(d['packageName'] ?? '—'),
      activityNames: Array.isArray(d['activityNames']) ? d['activityNames'].map(String) : [],
      guideName: d['guideName'] ? String(d['guideName']) : null,
      guideId: d['guideId'] ? String(d['guideId']) : null,
      merch: Array.isArray(d['merch']) ? (d['merch'] as MerchLine[]) : [],
      groupHikers: Array.isArray(d['groupHikers'])
        ? d['groupHikers'].map((hiker: Record<string, unknown>) => ({
            name: String(hiker['name'] ?? ''),
            address: String(hiker['address'] ?? ''),
            emergencyContactName: String(hiker['emergencyContactName'] ?? ''),
            emergencyContactPhone: String(hiker['emergencyContactPhone'] ?? ''),
          }))
        : [],
      groupSurcharge: Number(d['groupSurcharge'] ?? 0) || 0,
      total,
      paymentMethod: String(d['paymentMethod'] ?? '—'),
      cardLast4: d['cardLast4'] ? String(d['cardLast4']) : null,
      createdAt: toDate(d['createdAt']),
      updatedAt: toDate(d['updatedAt']),

      status: STATUSES.includes(status as BookingStatus) ? (status as BookingStatus) : 'confirmed',
      paperwork: PAPERWORKS.includes(paperwork as PaperworkStatus)
        ? (paperwork as PaperworkStatus)
        : 'not_required',
      payment: PAYMENTS.includes(payment as PaymentStatus)
        ? (payment as PaymentStatus)
        : 'paid_in_full',

      deposit: Number(d['deposit'] ?? total) || 0,
      balanceDueBy: toDate(d['balanceDueBy']),

      permitRef: d['permitRef'] ? String(d['permitRef']) : null,
      permitIssuedAt: toDate(d['permitIssuedAt']),
      permitOffice: d['permitOffice'] ? String(d['permitOffice']) : null,
      demoBalancePaid: d['demoBalancePaid'] === true,
      demoBalancePaidAt: toDate(d['demoBalancePaidAt']),
      demoBalancePaymentMethod: d['demoBalancePaymentMethod']
        ? String(d['demoBalancePaymentMethod'])
        : null,
      permitFeeLodged: Number(d['permitFeeLodged'] ?? 0) || 0,
      permitLodged: !!d['permitLodged'],

      riskAckAt: toDate(d['riskAckAt']),
      riskAckVersion: String(d['riskAckVersion'] ?? ''),

      uid: String(d['uid'] ?? ''),
      userName: String(d['userName'] ?? ''),
      userEmail: String(d['userEmail'] ?? ''),
    };
  }

  /** Performs the to review operation for this feature and returns its result to the caller. */
  private toReview(id: string, d: Record<string, any>): AdminReview {
    const trailId = String(d['trailId'] ?? '');
    return {
      id,
      trailId,
      trailName: String(d['trailName'] || this.trailName(trailId)),
      uid: String(d['uid'] ?? ''),
      author: String(d['author'] ?? 'Anonymous'),
      rating: Number(d['rating'] ?? 0) || 0,
      text: String(d['text'] ?? ''),
      createdAt: toDate(d['createdAt']),
    };
  }
}

const STATUSES: BookingStatus[] = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
const PAPERWORKS: PaperworkStatus[] = [
  'not_required', 'awaiting_docs', 'under_review', 'needs_correction',
  'permit_pending', 'cleared', 'denied',
];
const PAYMENTS: PaymentStatus[] = ['deposit_paid', 'balance_due', 'paid_in_full', 'refunded', 'lapsed'];

function toUser(uid: string, d: Record<string, any>): AdminUser {
  // The hiker app nests the profile; an older admin draft stored name/email
  // at the top level. Read both so neither kind of document shows blank.
  const p = (d['profile'] ?? {}) as Record<string, any>;
  const s = (k: string) => String(p[k] ?? d[k] ?? '');
  const avatar = s('avatar');
  const role = String(d['role'] ?? '');
  return {
    uid,
    name: s('name'),
    email: s('email'),
    phone: s('phone'),
    avatar: avatar.startsWith('https://i.pravatar.cc/') ? '' : avatar,
    location: s('location'),
    bio: s('bio'),
    dob: s('dob'),
    gender: s('gender'),
    emergencyContactName: s('emergencyContactName'),
    emergencyContactPhone: s('emergencyContactPhone'),
    role: role === 'admin' || role === 'permit_office' || role === 'guide' ? role : 'hiker',
    office: String(d['office'] ?? ''),
    guideRosterId: String(d['guideRosterId'] ?? ''),
    status: d['status'] === 'suspended' ? 'suspended' : 'active',
    createdAt: toDate(d['createdAt']),
    upcoming: Array.isArray(d['upcoming']) ? (d['upcoming'] as SavedTrail[]) : [],
  };
}

function toCertificate(id: string, d: Record<string, any>): AdminCertificate {
  const status = d['status'];
  return {
    id,
    uid: String(d['uid'] ?? ''),
    type: 'medical',
    fileName: String(d['fileName'] ?? 'document'),
    mimeType: String(d['mimeType'] ?? ''),
    size: Number(d['size'] ?? 0) || 0,
    status: status === 'approved' || status === 'rejected' ? status : 'pending',
    note: String(d['note'] ?? ''),
    uploadedAt: toDate(d['uploadedAt']),
    reviewedAt: toDate(d['reviewedAt']),
    reviewedBy: String(d['reviewedBy'] ?? ''),
    userName: String(d['userName'] ?? ''),
    userEmail: String(d['userEmail'] ?? ''),
  };
}

function toPost(id: string, d: Record<string, any>): AdminPost {
  const list = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]) : []);
  return {
    id,
    authorUid: String(d['authorUid'] ?? ''),
    authorName: String(d['authorName'] ?? 'Trail Hiker'),
    avatar: '',
    text: String(d['text'] ?? ''),
    images: list('images').map(String),
    trailId: String(d['trailId'] ?? ''),
    trailName: String(d['trailName'] ?? ''),
    rating: Number(d['rating'] ?? 0) || 0,
    upvotes: list('likedBy').length,
    downvotes: list('downvotedBy').length,
    commentCount: Number(d['commentCount'] ?? 0) || 0,
    repostOf: d['repostOf'] ? String(d['repostOf']) : null,
    createdAt: toDate(d['createdAt']),
    edited: !!d['editedAt'],
  };
}