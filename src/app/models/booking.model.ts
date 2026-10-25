/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BOOKING MODEL
 *
 * A NEW file. Nothing here edits trail.model.ts, trail.service.ts or
 * user.service.ts, so your teammates' work is untouched. Every booking points
 * at a trail by its id — the same side-table pattern the reviews and the map
 * coordinates already use.
 *
 * All prices are Philippine pesos, whole numbers. No decimals anywhere: the
 * rate sheet has none, and floating-point money is a bug waiting to happen.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { PaperworkStatus, PaymentStatus } from './booking-workflow';

export type PackageId = string;
export const MAX_GROUP_HIKERS = 30;

export interface HikePackage {
  id: PackageId;
  name: string;
  price: number;
  /** Bullet list shown under the package name on the booking page. */
  includes: string[];
  /**
   * How many add-on activities this package price already covers. The hiker
   * still chooses WHICH ones — anything beyond this count is charged at the
   * activity's own rate.
   */
  includedActivities: number;
  /**
   * Which activities the package is allowed to cover. The rate sheet is
   * specific: the free slot is "waterfall stop OR tree planting", never
   * canyoneering. Encoding it here means nobody has to remember the rule.
   */
  coversActivityIds: string[];
}

export interface HikeActivity {
  id: string;
  name: string;
  price: number;
  /** Small print — e.g. canyoneering is a starting rate, not a fixed one. */
  note?: string;
  icon: string;
}

export interface MerchItem {
  id: string;
  name: string;
  price: number;
  icon: string;
}

export interface Guide {
  id: string;
  name: string;
  years: number;
  summits: number;
  title?: string;
  bio?: string;
  specialties?: string[];
  languages?: string[];
  photoUrl?: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  audience: string;
  pricePerMonth: number;
  perks: string[];
}

/** One merchandise row on the receipt. */
export interface MerchLine {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * What the hiker has chosen so far. Lives in memory only, from the booking
 * page through to checkout — an abandoned draft should not linger in storage.
 */
export interface BookingDraft {
  trailId: string;
  trailName: string;
  trailImage: string;
  trailDuration: string;
  /** Local calendar date, yyyy-mm-dd. */
  date: string;
  packageId: PackageId;
  activityIds: string[];
  guideId: string | null;
  /** Item id -> quantity. Zero-quantity keys are pruned on write. */
  merch: Record<string, number>;
  /** Required for group bookings; includes the person making the booking. */
  groupHikers?: GroupHiker[];
}

export interface GroupHiker {
  name: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

/** The priced breakdown of a draft. Computed, never stored. */
export interface BookingQuote {
  packageName: string;
  packagePrice: number;
  /** Activities the package price already covers — shown at ₱0. */
  coveredActivities: { id: string; name: string }[];
  /** Activities charged on top. */
  paidActivities: { id: string; name: string; price: number }[];
  merchLines: MerchLine[];
  activitiesTotal: number;
  merchTotal: number;
  groupSurcharge: number;
  subtotal: number;
  transactionFee: number;
  total: number;

  /**
   * Taken at checkout: this trail's permit or entrance fee plus the
   * transaction fee. Carved OUT of the total, never added to it — the package
   * price already covers barangay registration, the environmental fee and the
   * trail fee, so adding the permit fee again would charge the hiker twice.
   */
  deposit: number;
  /** What falls due once the permit is released. */
  balance: number;
}

/**
 * A booking. Persisted.
 *
 * Note what is NOT in here: no card number, no CVV, no expiry. Only the last
 * four digits and the method name, which is all a receipt ever needs. Storing
 * more would be storing a liability.
 */
export interface Booking {
  id: string;
  /** Human-facing code shown on the confirmation screen, e.g. HIK-98231. */
  reference: string;
  trailId: string;
  trailName: string;
  trailImage: string;
  date: string;
  packageId: PackageId;
  packageName: string;
  activityNames: string[];
  guideName: string | null;
  merch: MerchLine[];
  groupHikers?: GroupHiker[];
  groupSurcharge?: number;
  total: number;
  paymentMethod: string;
  cardLast4: string | null;
  createdAt: string;

  /**
   * Where the trip stands.
   *
   * 'pending' is where a new booking now starts: paying the deposit holds the
   * date, it does not confirm the hike. Only an admin moves it to 'confirmed',
   * and only once the documents, the permit, the guide and the balance are all
   * settled. 'no_show' is recorded by the guide at the trailhead.
   */
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

  /** Where the documents and the permit stand. See booking-workflow.ts. */
  paperwork?: PaperworkStatus;
  /** Where the money stands. */
  payment?: PaymentStatus;

  /** Pesos taken at checkout. The rest is the balance. */
  deposit?: number;
  /** ISO date the balance stops being payable and the slot is released. */
  balanceDueBy?: string | null;

  /** What the issuing office granted. Written by an admin, never by a hiker. */
  permitRef?: string | null;
  permitIssuedAt?: string | null;
  permitOffice?: string | null;
  /** Demo-only balance simulation. Never treat this as money received. */
  demoBalancePaid?: boolean;
  demoBalancePaidAt?: string | null;
  demoBalancePaymentMethod?: string | null;
  /**
   * The part of the permit fee the office keeps even if the hike does not
   * happen. Usually 0 — it comes straight out of the hiker's refund, so only
   * fill it in with a receipt in hand.
   */
  permitFeeLodged?: number;

  /** When the hiker accepted the risk sheet, and which wording they saw. */
  riskAckAt?: string | null;
  riskAckVersion?: string | null;

  /** Who booked it. Added so the admin panel can show every hiker's bookings. */
  uid?: string;
  userName?: string;
  userEmail?: string;
  /** Internal: this booking has reached Firestore at least once. */
  synced?: boolean;
}