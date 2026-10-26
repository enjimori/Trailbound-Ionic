/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PERMIT OFFICE — data
 *
 * The issuing body's view: a barangay, a municipal tourism office, a DENR
 * protected-area office. Deliberately NOT AdminDataService, which opens a
 * listener on every collection — an officer has no business reading the
 * community feed, other hikers' profiles or anybody's payment details, and a
 * ruleset that correctly refuses them would make that service fail outright.
 *
 * So this service asks for exactly two things:
 *
 *   bookings where permitLodged == true   the applications sent to them
 *   certificates/{uid}_medical            on demand, one hiker at a time
 *
 * TrailBound does not issue permits. An officer here records what their own
 * office decided, and that decision is what the hiker's tracker reflects.
 *
 * ── On reading medical certificates ──────────────────────────────────────
 * A medical certificate is sensitive health data under the Data Privacy Act,
 * and the office needs it because fitness to climb is the basis on which they
 * issue. Two controls make that defensible rather than merely convenient:
 * they can only open one attached to an application actually sent to them,
 * and every opening is written to certificate_access with who, which and
 * when. The log is append-only — nobody can read it back from the app, only
 * from the Firebase console — so it cannot be quietly tidied up.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  type FirestoreError,
  type Unsubscribe,
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { adminDb } from '../admin-firebase';
import { toDate } from '../admin-utils';
import { BALANCE_WINDOW_DAYS, type PaperworkStatus } from '../../../models/booking-workflow';
import type { CertificateStatus } from '../../../models/certificate.model';
import { suggestedPermitRef } from './permit-ref';

/** One application, with only the fields an issuing office needs. */
export interface OfficeApplication {
  id: string;
  reference: string;
  trailName: string;
  /** Hike date, yyyy-mm-dd. */
  date: string;
  headcount: number;
  hikerName: string;
  hikerEmail: string;
  hikerUid: string;
  office: string;
  paperwork: PaperworkStatus;
  permitRef: string | null;
  permitIssuedAt: Date | null;
  lodgedAt: Date | null;
  riskAckAt: Date | null;
  /** The booking's own status — 'cancelled' means TrailBound withdrew it. */
  status: string;
}

/** What the office is shown about a hiker's medical certificate. */
export interface MedicalSummary {
  exists: boolean;
  status: CertificateStatus | null;
  fileName: string;
  uploadedAt: Date | null;
  /** TrailBound's own review note, when they asked for a correction. */
  note: string;
}

@Injectable({ providedIn: 'root' })
export class OfficeDataService {
  private readonly _apps = signal<OfficeApplication[]>([]);
  private readonly _loaded = signal(false);
  private readonly _error = signal('');

  readonly applications = this._apps.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly error = this._error.asReadonly();

  /** Still to decide — what the queue badge counts. */
  readonly waiting = computed(() => this._apps().filter((a) => a.paperwork === 'permit_pending'));

  private unsub: Unsubscribe | null = null;

  /**
   * Starts the queue.
   *
   * permitLodged is the scoping flag: an application exists for the office
   * only once TrailBound has actually sent it. Nothing in a hiker's basket,
   * and nothing abandoned at checkout, is ever visible here.
   *
   * With one office account this returns every lodged application. When a
   * second office is added, narrow the query with a second where() on
   * permitOffice rather than filtering in the component — the point of the
   * flag is that the server refuses, not that the screen hides.
   */
  start(): void {
    if (this.unsub) return;
    this.unsub = onSnapshot(
      query(collection(adminDb, 'bookings'), where('permitLodged', '==', true)),
      (snap) => {
        this._apps.set(
          snap.docs
            .map((d) => toApplication(d.id, d.data({ serverTimestamps: 'estimate' })))
            .sort((a, b) => (a.date || '').localeCompare(b.date || '')),
        );
        this._loaded.set(true);
        this._error.set('');
      },
      (err: FirestoreError) => {
        console.error('[office] applications:', err);
        this._error.set(
          err.code === 'permission-denied'
            ? 'Firebase refused this account access to the application queue. Publish the latest firestore.rules.'
            : err.message,
        );
      },
    );
  }

  /** Performs the stop operation for this feature and returns its result to the caller. */
  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this._apps.set([]);
    this._loaded.set(false);
    this._error.set('');
  }

  // ── the hiker's medical certificate ──────────────────────────────────────

  /** Whether a certificate exists and what TrailBound made of it. No file yet. */
  async medicalFor(uid: string): Promise<MedicalSummary> {
    const snap = await getDoc(doc(adminDb, 'certificates', `${uid}_medical`));
    if (!snap.exists()) {
      return { exists: false, status: null, fileName: '', uploadedAt: null, note: '' };
    }
    const d = snap.data();
    const status = d['status'];
    return {
      exists: true,
      status: status === 'approved' || status === 'rejected' ? status : 'pending',
      fileName: String(d['fileName'] ?? 'document'),
      uploadedAt: toDate(d['uploadedAt']),
      note: String(d['note'] ?? ''),
    };
  }

  /**
   * The certificate image itself, as a data URL — and a line in the access
   * log before it is returned.
   *
   * The log write comes first on purpose. If it fails, the read does not
   * happen: an unlogged look at someone's health record is the thing this is
   * here to prevent, and failing closed is the only version of that which
   * actually holds.
   */
  async openMedical(uid: string, app: OfficeApplication, officerEmail: string): Promise<string> {
    await addDoc(collection(adminDb, 'certificate_access'), {
      certificateId: `${uid}_medical`,
      subjectUid: uid,
      openedBy: officerEmail,
      role: 'permit_office',
      reason: `Permit application ${app.reference} — ${app.trailName}`,
      at: serverTimestamp(),
    });

    const snap = await getDoc(doc(adminDb, 'certificate_files', `${uid}_medical`));
    const data = String(snap.data()?.['data'] ?? '');
    if (!data) throw new Error('missing-file');
    return data;
  }

  // ── decisions ────────────────────────────────────────────────────────────

  /**
   * The office issued the permit.
   *
   * Clearing the paperwork is what makes the balance payable, so both land in
   * one write — a cleared permit with nothing due next would leave the
   * booking stuck with no move available to anyone.
   */
  issue(app: OfficeApplication, permitRef = ''): Promise<void> {
    const ref = permitRef.trim() || suggestedPermitRef(app.reference, app.date);
    if (!ref) return Promise.reject(new Error('Could not generate a permit reference for this application.'));

    const due = new Date();
    due.setDate(due.getDate() + BALANCE_WINDOW_DAYS);
    return updateDoc(doc(adminDb, 'bookings', app.id), {
      permitRef: ref.slice(0, 60),
      permitIssuedAt: serverTimestamp(),
      paperwork: 'cleared' satisfies PaperworkStatus,
      payment: 'balance_due',
      balanceDueBy: due.toISOString(),
      updatedAt: serverTimestamp(),
    });
  }

  /** The office refused. The hike cannot go ahead. */
  refuse(app: OfficeApplication, reason: string): Promise<void> {
    return updateDoc(doc(adminDb, 'bookings', app.id), {
      paperwork: 'denied' satisfies PaperworkStatus,
      permitNote: reason.trim().slice(0, 300),
      updatedAt: serverTimestamp(),
    });
  }
}

function toApplication(id: string, d: Record<string, any>): OfficeApplication {
  const paperwork = String(d['paperwork'] ?? '');
  return {
    id,
    reference: String(d['reference'] ?? id),
    trailName: String(d['trailName'] ?? ''),
    date: String(d['date'] ?? ''),
    headcount: Number(d['headcount'] ?? 1) || 1,
    hikerName: String(d['userName'] ?? ''),
    hikerEmail: String(d['userEmail'] ?? ''),
    hikerUid: String(d['uid'] ?? ''),
    office: String(d['permitOffice'] ?? ''),
    paperwork: (paperwork || 'permit_pending') as PaperworkStatus,
    permitRef: d['permitRef'] ? String(d['permitRef']) : null,
    permitIssuedAt: toDate(d['permitIssuedAt']),
    lodgedAt: toDate(d['updatedAt']) ?? toDate(d['createdAt']),
    riskAckAt: toDate(d['riskAckAt']),
    status: String(d['status'] ?? ''),
  };
}