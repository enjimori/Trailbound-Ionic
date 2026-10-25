/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BOOKING WORKFLOW — the three statuses, the deposit, what blocks a
 * confirmation, and what a refund comes to
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

  /**
   * The permit fee the issuing office KEEPS, in pesos. Zero in most cases.
   *
   * ── SET THIS CAREFULLY ────────────────────────────────────────────────
   * Not "the fee we paid when we lodged the application" — the fee that is
   * gone even though the hike is not happening. Most offices do not charge
   * for a refused application, or return it, in which case this stays zero
   * and the hiker gets their deposit back less the transaction fee.
   *
   * Setting it on every lodging would mean a hiker whose permit is denied
   * before they pay the balance recovers nothing at all: ₱140 lodged plus
   * the ₱50 fee is the whole ₱190 deposit. Admin should only fill this in
   * with a receipt in hand.
   */
  permitFeeLodged?: number;

  /** Money, in pesos. */
  deposit: number;
  total: number;

  /** When the balance stops being payable and the slot is released. */
  balanceDueBy?: Date | null;

  /** Set once a refund has been decided. */
  refund?: RefundRecord | null;

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
 * "₱190 — that is the barangay's ₱140 plus our ₱50 transaction fee" is
 * answerable at a glance; "30%" invites an argument about what is refundable.
 *
 * Note this is carved OUT of the total, not added to it: the package price
 * already covers barangay registration, the environmental fee and the trail
 * fee. Adding the permit fee again would charge the hiker twice.
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

// ── refunds ─────────────────────────────────────────────────────────────────

/**
 * Bump when the tiers below change. A dispute three months from now is not
 * settled by "they agreed to the policy" — it is settled by knowing WHICH
 * policy they were shown, which is what this records.
 */
export const REFUND_POLICY_VERSION = '2026-10-25';

/** Why money is going back. The reason decides the arithmetic. */
export type RefundReason =
  | 'hiker_cancelled'
  | 'trailbound_cancelled'
  | 'permit_denied'
  | 'certificate_rejected'
  | 'balance_lapsed'
  | 'no_show';

/**
 * Cancellation tiers, by how many days before the hike the hiker pulls out.
 *
 * The cliff at three days is the guide's calendar: a Saturday blocked out on
 * Thursday cannot be refilled. Earlier than that and nothing has been lost,
 * so there is no case for keeping the money.
 */
export const CANCELLATION_TIERS: { minDays: number; refundRate: number; label: string }[] = [
  { minDays: 7, refundRate: 1, label: '7 or more days before' },
  { minDays: 3, refundRate: 0.5, label: '3 to 6 days before' },
  { minDays: 0, refundRate: 0, label: 'Less than 3 days before' },
];

export interface RefundInput {
  reason: RefundReason;
  /** Everything taken from the hiker so far. */
  grossPaid: number;
  /** The payment gateway's cut. It keeps this whatever happens. */
  transactionFee: number;
  /**
   * The part of the permit fee the office keeps despite refusing. Usually 0 —
   * see the note on BookingWorkflow.permitFeeLodged before passing anything
   * else, because this comes straight out of the hiker's deposit.
   */
  permitFeeLodged: number;
  /** Days from today to the hike date. Negative once the date has passed. */
  daysBeforeHike: number;
}

export interface RefundOutcome {
  refunded: number;
  nonRefundable: number;
  reason: RefundReason;
  /** One sentence, written for the hiker rather than for the ledger. */
  explain: string;
  policyVersion: string;
}

/** What gets stored on the booking once an admin acts on it. */
export interface RefundRecord extends RefundOutcome {
  decidedAt: Date;
  /** The admin who approved it. */
  decidedBy: string;
}

/**
 * Works out what comes back.
 *
 * The governing idea: the hiker never loses money over something that was not
 * their decision, beyond what is genuinely already spent. The gateway's cut
 * and a permit fee already handed to a barangay are spent; a guide's time
 * three weeks out is not.
 */
export function refundFor(input: RefundInput): RefundOutcome {
  const gross = Math.max(0, Math.round(input.grossPaid));
  const fee = Math.max(0, Math.round(input.transactionFee));
  const lodged = Math.max(0, Math.round(input.permitFeeLodged));

  const done = (refunded: number, explain: string): RefundOutcome => {
    const r = clamp(Math.round(refunded), 0, gross);
    return {
      refunded: r,
      nonRefundable: gross - r,
      reason: input.reason,
      explain,
      policyVersion: REFUND_POLICY_VERSION,
    };
  };

  switch (input.reason) {
    // TrailBound could not deliver. The gateway's cut is absorbed rather than
    // charged to someone whose hike was cancelled for them.
    case 'trailbound_cancelled':
      return done(gross, 'We could not run this hike, so everything you paid is returned — the transaction fee included.');

    // Not the hiker's fault either, but the office has the permit fee and the
    // gateway has its cut. Both are genuinely gone.
    case 'permit_denied':
      return done(
        gross - fee - lodged,
        lodged > 0
          ? `Your permit was not granted. Everything is returned except the ₱${fee} transaction fee and the ₱${lodged} already paid to the issuing office.`
          : `Your permit was not granted. Everything is returned except the ₱${fee} transaction fee.`,
      );

    case 'certificate_rejected':
      return done(
        gross - fee - lodged,
        `Your documents were not accepted. Everything is returned except the ₱${fee} transaction fee. You can upload a new certificate and book again.`,
      );

    // Their decision, so the tiers apply to whatever is left after the money
    // that is already spent.
    case 'hiker_cancelled': {
      const tier = tierFor(input.daysBeforeHike);
      const refundable = Math.max(0, gross - fee - lodged);
      const back = refundable * tier.refundRate;
      return done(
        back,
        tier.refundRate === 1
          ? `Cancelled ${tier.label.toLowerCase()}, so everything is returned except the ₱${fee} transaction fee.`
          : tier.refundRate === 0
            ? 'Cancelled less than three days before the hike, so the booking is not refundable — your guide had already blocked out the date.'
            : `Cancelled ${tier.label.toLowerCase()}, so half of the refundable amount is returned.`,
      );
    }

    // They were told the date and the amount, in writing, before they paid.
    case 'balance_lapsed':
      return done(0, 'The balance was not paid by the deadline, so the booking was released and the deposit is not returned.');

    case 'no_show':
      return done(0, 'The group went out as booked and you did not join, so the booking is not refundable.');
  }
}

/** Which cancellation tier a number of days falls into. */
export function tierFor(daysBeforeHike: number): { minDays: number; refundRate: number; label: string } {
  const d = Math.floor(daysBeforeHike);
  return CANCELLATION_TIERS.find((t) => d >= t.minDays) ?? CANCELLATION_TIERS[CANCELLATION_TIERS.length - 1];
}

/** Whole days from now until a yyyy-mm-dd hike date. Negative once past. */
export function daysUntil(hikeDate: string, from = new Date()): number {
  const target = new Date(hikeDate + 'T00:00:00');
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
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

// ── progress tracker ────────────────────────────────────────────────────────

/**
 * What a hiker sees on their booking while it works its way through.
 *
 * The steps are DERIVED from the trail's own requirements rather than being a
 * fixed list. A trail that wants a medical certificate shows the document
 * steps; one that does not simply has fewer steps, instead of showing a row
 * greyed out forever with no explanation. Same for the permit: a trail with
 * no issuing office has no permit step.
 */
export type StepState = 'done' | 'current' | 'blocked' | 'upcoming';

export interface ProgressStep {
  id: 'placed' | 'documents' | 'permit' | 'balance' | 'confirmed' | 'ended';
  title: string;
  /** One line saying where it stands, in the hiker's terms. */
  detail: string;
  state: StepState;
}

export interface ProgressInput {
  status: BookingStatus;
  paperwork: PaperworkStatus;
  payment: PaymentStatus;
  /** From trail-permits.ts — decides whether the document step exists at all. */
  requiresMedical: boolean;
  /** False only for an open-access trail with nothing to apply for. */
  hasPermitAuthority: boolean;
  /** "Mt. Pulag National Park — PASu Office", for the permit step's detail. */
  permitOffice?: string;
  permitRef?: string | null;
  /** Still owed, in pesos. */
  balance?: number;
  /** Formatted however the calling page formats dates. */
  balanceDueBy?: string | null;
  guideName?: string | null;
}

export function bookingProgress(i: ProgressInput): ProgressStep[] {
  // A booking that ended stops pretending to be in progress. Showing four
  // greyed-out future steps under a cancelled booking reads as a bug.
  if (i.status === 'cancelled' || i.status === 'no_show') {
    return [
      { id: 'placed', title: 'Booking placed', detail: 'Received and recorded.', state: 'done' },
      {
        id: 'ended',
        title: i.status === 'no_show' ? 'Did not join' : 'Cancelled',
        detail:
          i.payment === 'refunded'
            ? 'This booking was cancelled and your refund has been processed.'
            : i.status === 'no_show'
              ? 'The group went out without you.'
              : 'This booking was cancelled.',
        state: 'blocked',
      },
    ];
  }

  const steps: ProgressStep[] = [];
  const done = i.paperwork === 'cleared';

  steps.push({
    id: 'placed',
    title: 'Booking placed',
    detail: i.guideName
      ? `Your deposit is paid and ${i.guideName} is assigned as your guide.`
      : 'Your deposit is paid. We are assigning your guide.',
    state: 'done',
  });

  if (i.requiresMedical) {
    steps.push({
      id: 'documents',
      title: 'Medical certificate',
      detail:
        i.paperwork === 'awaiting_docs'
          ? 'We still need your certificate before this booking can move on.'
          : i.paperwork === 'under_review'
            ? 'Received and with our reviewer. Nothing for you to do.'
            : i.paperwork === 'needs_correction'
              ? 'Your certificate was not accepted. Upload a new one to continue.'
              : 'Approved.',
      state:
        i.paperwork === 'awaiting_docs' || i.paperwork === 'needs_correction'
          ? 'blocked'
          : i.paperwork === 'under_review'
            ? 'current'
            : 'done',
    });
  }

  if (i.hasPermitAuthority) {
    const office = i.permitOffice || 'the issuing office';
    steps.push({
      id: 'permit',
      title: 'Permit',
      detail:
        i.paperwork === 'denied'
          ? 'Your permit was not granted. We are processing your refund.'
          : i.paperwork === 'cleared'
            ? i.permitRef
              ? `Released by ${office}. Reference ${i.permitRef}.`
              : `Released by ${office}.`
            : i.paperwork === 'permit_pending'
              ? `Lodged with ${office}. We will let you know as soon as it is released.`
              : `We apply to ${office} once your documents are cleared.`,
      state:
        i.paperwork === 'denied'
          ? 'blocked'
          : i.paperwork === 'cleared'
            ? 'done'
            : i.paperwork === 'permit_pending'
              ? 'current'
              : 'upcoming',
    });
  }

  const owed = i.balance ?? 0;
  steps.push({
    id: 'balance',
    title: 'Balance',
    detail:
      i.payment === 'paid_in_full'
        ? 'Paid in full.'
        : i.payment === 'lapsed'
          ? 'The balance was not paid in time and this date has been released.'
          : i.payment === 'balance_due'
            ? i.balanceDueBy
              ? `₱${owed.toLocaleString('en-PH')} due by ${i.balanceDueBy}.`
              : `₱${owed.toLocaleString('en-PH')} due now.`
            : `₱${owed.toLocaleString('en-PH')} falls due once your permit is released.`,
    state:
      i.payment === 'paid_in_full'
        ? 'done'
        : i.payment === 'lapsed'
          ? 'blocked'
          : i.payment === 'balance_due'
            ? 'current'
            : 'upcoming',
  });

  const confirmed = i.status === 'confirmed' || i.status === 'completed';
  steps.push({
    id: 'confirmed',
    title: i.status === 'completed' ? 'Hike completed' : 'Confirmed',
    detail: confirmed
      ? i.status === 'completed'
        ? 'Your guide marked this hike complete. Your certificate is in your profile.'
        : 'You are all set. Your receipt and trip details are below.'
      : 'Once everything above is cleared, your hike is confirmed and your full details appear here.',
    state: confirmed ? 'done' : 'upcoming',
  });

  // Exactly one step is "current": the first that is not finished. Without
  // this, a blocked document step and a pending permit both look active and
  // the hiker cannot tell which one is actually waiting on them.
  const firstUnfinished = steps.findIndex((s) => s.state !== 'done');
  steps.forEach((s, idx) => {
    if (s.state === 'current' && idx !== firstUnfinished) s.state = 'upcoming';
  });

  return steps;
}

/** True once the hiker should see the receipt and the full trip details. */
export function detailsUnlocked(status: BookingStatus): boolean {
  return status === 'confirmed' || status === 'completed';
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

export const REFUND_REASON_LABEL: Record<RefundReason, string> = {
  hiker_cancelled: 'Cancelled by the hiker',
  trailbound_cancelled: 'Cancelled by TrailBound',
  permit_denied: 'Permit denied',
  certificate_rejected: 'Documents not accepted',
  balance_lapsed: 'Balance not paid in time',
  no_show: 'Did not join the hike',
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