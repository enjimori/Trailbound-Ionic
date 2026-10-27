/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SUBSCRIPTION PLANS — TrailBound Basic, Pro and legacy Facilitator
 *
 * Customer checkout offers Basic and Pro. Facilitator is retained for legacy
 * subscription data and is not offered through customer checkout.
 *
 * ★ = the MLP (Prepare for Your Hike). Each plan has its own version of it.
 * All prices are Philippine pesos per month, whole numbers.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type PlanId = 'basic' | 'pro' | 'facilitator';

export interface PlanPerk {
  text: string;
  /** True for the "Prepare for Your Hike" (MLP) perk — highlighted in the UI. */
  mlp?: boolean;
  /** Where to find it in the app, shown under the perk. */
  where?: string;
}

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  /** Short label for small spaces, e.g. the pill on the Profile tab. */
  shortName: string;
  audience: string;
  pricePerMonth: number;
  perks: PlanPerk[];
}

export const FACILITATOR_ADMIN_PRICE = 999;

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'basic',
    name: 'TrailBound Basic',
    shortName: 'Basic',
    audience: 'For users',
    pricePerMonth: 79,
    perks: [
      {
        text: 'On every trail page: gear checklist, difficulty level and simple first-aid tips',
        mlp: true,
      },
      { text: 'Trail navigation', where: 'Trail page → Start Hike' },
      { text: 'Weather forecast for your booked hike date', where: 'Bookings tab, on each upcoming hike' },
      { text: 'Mountain suggestions by skill level', where: 'Home tab' },
      { text: 'Real-time budget tracker during booking', where: 'Booking page' },
      { text: 'Save itineraries (up to 3)', where: 'Profile → My Itineraries' },
    ],
  },
  {
    id: 'pro',
    name: 'TrailBound Pro',
    shortName: 'Pro',
    audience: 'For frequent users',
    pricePerMonth: 149,
    perks: [
      { text: 'Everything in Basic, plus:' },
      {
        text: 'Smart version: the gear checklist adjusts to live weather and multi-day trips',
        mlp: true,
      },
      { text: 'Real-time weather monitoring', where: 'Trail page and Trail navigation' },
      { text: 'Unlimited saved itineraries and planning', where: 'Profile → My Itineraries' },
      { text: 'Priority booking access on high-demand trails', where: 'Booking page on popular trails' },
      {
        text: 'Advanced trip-management tools (multi-day trips, group coordination, shared group gear checklist)',
        where: 'Inside each itinerary',
      },
      { text: 'Exclusive merchandise discounts (15% off)', where: 'Booking page → Merchandise' },
    ],
  },
  {
    id: 'facilitator',
    name: 'TrailBound Facilitator',
    shortName: 'Facilitator',
    audience: 'For TrailBound staff',
    pricePerMonth: FACILITATOR_ADMIN_PRICE,
    perks: [
      { text: 'Digital certification and document tracking', where: 'Admin → Certificates' },
      { text: 'Admin analytics', where: 'Admin dashboard' },
    ],
  },
];

/** Plans available for purchase in the hiker-facing app. */
export const CUSTOMER_SUBSCRIPTION_PLANS = SUBSCRIPTION_PLANS.filter(
  (plan) => plan.id !== 'facilitator',
);

export function isCustomerPlan(id: PlanId): boolean {
  return CUSTOMER_SUBSCRIPTION_PLANS.some((plan) => plan.id === id);
}

/** Undefined for an unknown id (e.g. a mistyped ?plan= link). */
export function planById(id: string | null | undefined): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id);
}

/**
 * Which customer plans unlock which hiker feature.
 * Add a feature here, then check it with SubscriptionService.has('...').
 */
export type Feature =
  // TrailBound Basic
  | 'prepareForHike'
  | 'trailNavigation'
  | 'hikeDateForecast'
  | 'skillSuggestions'
  | 'budgetTracker'
  | 'saveItineraries'
  // TrailBound Pro
  | 'smartPrepare'
  | 'liveWeather'
  | 'unlimitedItineraries'
  | 'priorityBooking'
  | 'tripTools'
  | 'merchDiscount'
  // Facilitator
  | 'facilitatorTools';

const BASIC_UP: PlanId[] = ['basic', 'pro'];
const PRO_UP: PlanId[] = ['pro'];

export const FEATURE_PLANS: Record<Feature, PlanId[]> = {
  prepareForHike: BASIC_UP,
  trailNavigation: BASIC_UP,
  hikeDateForecast: BASIC_UP,
  skillSuggestions: BASIC_UP,
  budgetTracker: BASIC_UP,
  saveItineraries: BASIC_UP,

  smartPrepare: PRO_UP,
  liveWeather: PRO_UP,
  unlimitedItineraries: PRO_UP,
  priorityBooking: PRO_UP,
  tripTools: PRO_UP,
  merchDiscount: PRO_UP,

  facilitatorTools: ['facilitator'],
};

/** The cheapest plan that unlocks a feature — what a lock button offers. */
export function planFor(feature: Feature): SubscriptionPlan {
  const ids = FEATURE_PLANS[feature];
  return SUBSCRIPTION_PLANS.filter((p) => ids.includes(p.id))
    .sort((a, b) => a.pricePerMonth - b.pricePerMonth)[0];
}

/** Saved itineraries allowed on Basic. Pro has no limit. */
export const BASIC_ITINERARY_LIMIT = 3;

/** Pro discount on merchandise added during booking. */
export const MERCH_DISCOUNT_RATE = 0.15;

/** Saved on the hiker's Firestore document as users/{uid}.subscription. */
export interface UserSubscription {
  plan: PlanId;
  /** 'cancelled' keeps access until renewsAt, then the plan ends. */
  status: 'active' | 'cancelled';
  /** ISO date-times. */
  startedAt: string;
  renewsAt: string;
  /** e.g. "Card", "Maya (Sandbox)". */
  paymentMethod: string;
}
