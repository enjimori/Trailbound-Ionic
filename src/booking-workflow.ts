/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BOOKING WORKFLOW — the three statuses, the deposit, and what blocks a
 * confirmation
 *
 * Pure types and functions. No Firestore, no Angular, nothing to inject — so
 * both the hiker app and the admin panel can use it, and it can be reasoned
 * about without running anything.
 *
 * ── WHY THREE FIELDS AND NOT ONE ──────────────────────────────────────────
 * A booking can have a paid deposit, an approved medical certificate, and
 * still be waiting on a barangay. One status field cannot express that; it
 * forces a single queue out of three independent ones, and the admin list
 * then cannot say which of the three is holding a booking up.
 *
 *   status      where the trip stands
 *   paperwork   where the documents and the permit stand
 *   payment     where the money stands
 *
 * They move independently. `confirmed` is the one place they meet, and
 * canConfirm() below is the only thing allowed to decide it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ── the three fields ────────────────────────────────────────────────────────

/**
 * Where the trip stands.
 *
 * Note that `pending` is new and is now what a fresh booking gets. Today
 * BookingService.confirm() writes 'confirmed' at checkout; under this workflow
 * paying is not confirming, so that call has to change along with this type.
 */
export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show';

/** Where the documents and the permit stand. */
export type PaperworkStatus =
  | 'not_required'
  | 'awaiting_docs'
  | 'under_review'
  | 'needs_correction'
  | 'permit_pending'
  | 'cleared'
  | 'denied';

/** Where the money stands. */
export type PaymentStatus =
  | 'deposit_paid'
  | 'balance_due'
  | 'paid_in_full'
  | 'refunded'
  | 'lapsed';

/** The workflow fields added to a booking document. */
export interface BookingWorkflow {
  status: BookingStatus;
  paperwork: PaperworkStatus;
  payment: PaymentStatus;

  /** When the hiker accepted the risk sheet, and which wording they saw. */
  riskAckAt?: Date | null;
  riskAckVersion?: string;

  /** What the issuing office granted. Written by admin, never by a hiker. */
  permitRef?: string | null;
  permitIssuedAt?: Date | null;
  permitOffice?: string | null;

  /** Money, in pesos. */
  deposit: number;
  total: number;

  /** When the balance stops being payable and the slot is released. */
  balanceDueBy?: Date | null;

  guideName?: string | null;
}

// ── money ───────────────────────────────────────────────────────────────────

/**
 * Days a hiker has to settle the balance once the permit clears.
 *
 * A balance with no deadline holds a guide's date open indefinitely. Whatever
 * number this is, it has to be shown before checkout — a deadline a hiker
 * learns about only when they miss it is not a deadline, it is a trap.
 */
export const BALANCE_WINDOW_DAYS = 7;

/**
 * The deposit: the fees that are genuinely spent before the hike happens.
 *
 * Sized this way rather than as a flat percentage because it explains itself.
 * "₱250 — that is the park's ₱200 entrance fee plus our ₱50 transaction fee"
 * is answerable at a glance; "30%" invites an argument about what is
 * refundable.
 *
 * Pass transactionFee from TRANSACTION_FEE in booking-catalog.ts rather than
 * importing it here, so this file stays free of project imports.
 */
export function depositFor(permitFee: number, transactionFee: number, headcount = 1): number {
  const heads = Math.max(1, Math.floor(headcount));
  return Math.round(permitFee * heads + transactionFee);
}

/** What is still owed. Never negative, even if a total is edited downward. */
export function balanceFor(total: number, deposit: number): number {
  return Math.max(0, Math.round(total - deposit));
}

/** The deadline, counted from the moment the permit cleared. */
export function balanceDeadline(permitClearedAt: Date, days = BALANCE_WINDOW_DAYS): Date {
  const d = new Date(permitClearedAt);
  d.setDate(d.getDate() + days);
  return d;
}

// ── gates ───────────────────────────────────────────────────────────────────

/**
 * Everything that must be true before a booking can be confirmed.
 *
 * Kept as data rather than as a chain of ifs so that blockedBy() can report
 * the first unmet one to the admin screen, instead of the screen showing a
 * disabled button with no explanation.
 */
const GATES: { test: (b: BookingWorkflow, trailOpen: boolean) => boolean; why: string }[] = [
  {
    test: (b) => !!b.riskAckAt,
    why: 'The hiker has not accepted the risk acknowledgment',
  },
  {
    test: (b) => b.paperwork === 'cleared' || b.paperwork === 'not_required',
    why: 'Documents or permit are still outstanding',
  },
  {
    test: (b) => b.payment === 'paid_in_full',
    why: 'The balance has not been paid',
  },
  {
    test: (b) => !!b.guideName,
    why: 'No guide has been assigned',
  },
  {
    test: (_b, trailOpen) => trailOpen,
    why: 'The trail is currently closed',
  },
];

/** True when every gate is satisfied. */
export function canConfirm(b: BookingWorkflow, trailOpen: boolean): boolean {
  return GATES.every((g) => g.test(b, trailOpen));
}

/**
 * The first unmet gate, in plain words, or null when nothing blocks it.
 * This is what the admin booking row should show next to a pending booking —
 * "Waiting on: no guide assigned" rather than a bare "Pending".
 */
export function blockedBy(b: BookingWorkflow, trailOpen: boolean): string | null {
  return GATES.find((g) => !g.test(b, trailOpen))?.why ?? null;
}

/**
 * Where a brand new booking starts, decided by whether the trail asks for a
 * medical certificate and whether the hiker already has an approved one.
 */
export function initialPaperwork(
  trailRequiresMedical: boolean,
  medicalStatus: 'none' | 'pending' | 'approved' | 'rejected',
): PaperworkStatus {
  if (!trailRequiresMedical) return 'not_required';
  if (medicalStatus === 'approved') return 'permit_pending';
  if (medicalStatus === 'pending') return 'under_review';
  return 'awaiting_docs';
}

// ── display ─────────────────────────────────────────────────────────────────

export type Tone = 'ok' | 'warn' | 'stop' | 'muted';

/** Label and badge tone for each value, so every screen words them the same. */
export const STATUS_LABEL: Record<BookingStatus, { text: string; tone: Tone }> = {
  pending: { text: 'Pending', tone: 'warn' },
  confirmed: { text: 'Confirmed', tone: 'ok' },
  completed: { text: 'Completed', tone: 'ok' },
  cancelled: { text: 'Cancelled', tone: 'stop' },
  no_show: { text: 'No show', tone: 'stop' },
};

export const PAPERWORK_LABEL: Record<PaperworkStatus, { text: string; tone: Tone }> = {
  not_required: { text: 'Not required', tone: 'muted' },
  awaiting_docs: { text: 'Awaiting documents', tone: 'warn' },
  under_review: { text: 'Under review', tone: 'warn' },
  needs_correction: { text: 'Needs correction', tone: 'stop' },
  permit_pending: { text: 'Permit pending', tone: 'warn' },
  cleared: { text: 'Cleared', tone: 'ok' },
  denied: { text: 'Permit denied', tone: 'stop' },
};

export const PAYMENT_LABEL: Record<PaymentStatus, { text: string; tone: Tone }> = {
  deposit_paid: { text: 'Deposit paid', tone: 'warn' },
  balance_due: { text: 'Balance due', tone: 'warn' },
  paid_in_full: { text: 'Paid in full', tone: 'ok' },
  refunded: { text: 'Refunded', tone: 'stop' },
  lapsed: { text: 'Lapsed', tone: 'stop' },
};

/**
 * Reads a stored value back safely. Firestore documents written by an older
 * build will not have these fields at all, so every one needs a default —
 * without this, every existing booking renders as "undefined".
 */
export function readWorkflow(d: Record<string, unknown>): Pick<
  BookingWorkflow,
  'status' | 'paperwork' | 'payment'
> {
  const status = String(d['status'] ?? '');
  const paperwork = String(d['paperwork'] ?? '');
  const payment = String(d['payment'] ?? '');

  return {
    // Bookings made before this workflow existed were written as 'confirmed'
    // at checkout. Leave them confirmed; re-opening settled history would be
    // worse than the inconsistency.
    status: (status in STATUS_LABEL ? status : 'confirmed') as BookingStatus,
    paperwork: (paperwork in PAPERWORK_LABEL ? paperwork : 'not_required') as PaperworkStatus,
    payment: (payment in PAYMENT_LABEL ? payment : 'paid_in_full') as PaymentStatus,
  };
}
