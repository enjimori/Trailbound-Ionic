/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BOOKING CATALOG
 *
 * The lists the booking page shows and the prices BookingService uses:
 * packages, add-on activities, guides, merchandise, and the transaction fee.
 *
 * ── PRICES RESTORED FROM THE PROJECT RATE SHEET ───────────────────────────
 *
 * An earlier revision of this file was overwritten with placeholder figures.
 * Every package, activity and merchandise price below now matches the rate
 * sheet again. Two package RULES had also been lost and are restored:
 * Overnight Hike and Group Hike each include one free activity, which the
 * placeholder version charged for.
 *
 * Still placeholders, and still needing real data: the GUIDES roster.
 *
 * All prices are Philippine pesos, whole numbers. No decimals anywhere — the
 * rate sheet has none, and floating-point money is a bug waiting to happen.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  Guide, HikeActivity, HikePackage, MerchItem, PackageId,
} from '../../models/booking.model';

/**
 * Flat fee added to every booking.
 *
 * From the rate sheet: "₱1,440 + ₱50 transaction fee = ₱1,490" for a first
 * time hiker on the Basic Day Hike. Changing this changes every total in the
 * app, so it lives here alone.
 */
export const TRANSACTION_FEE = 50;

// ── Packages ────────────────────────────────────────────────────────────────

export const PACKAGES: HikePackage[] = [
  {
    id: 'basic',
    name: 'Basic Day Hike',
    price: 1440,
    includes: [
      'Tour guide',
      'Barangay registration / certification',
      'Environmental fee',
      'Trail / entrance fee',
      'Digital itinerary',
    ],
    includedActivities: 0,
    coversActivityIds: [],
  },
  {
    id: 'activity',
    name: 'Day Hike + Activity',
    price: 1800,
    includes: [
      'Everything in Basic Day Hike',
      '1 selected activity — waterfall stop or tree planting',
    ],
    includedActivities: 1,
    coversActivityIds: ['waterfall', 'tree-planting'],
  },
  {
    id: 'overnight',
    name: 'Overnight Hike',
    price: 2400,
    includes: [
      'Everything in Basic Day Hike',
      '1 selected activity — waterfall stop or tree planting',
      '1-night accommodation',
      'Overnight itinerary',
    ],
    // RESTORED: the placeholder version had this at 0, so the app charged for
    // an activity the package covers.
    includedActivities: 1,
    coversActivityIds: ['waterfall', 'tree-planting'],
  },
  {
    id: 'private',
    name: 'Private Hike',
    price: 3000,
    includes: [
      'Private tour guide',
      'Everything in Basic Day Hike',
      'Personalised itinerary',
    ],
    includedActivities: 0,
    coversActivityIds: [],
  },
  {
    id: 'group',
    name: 'Group Hike',
    price: 4200,
    includes: [
      'Group tour guide',
      'Everything in Day Hike + Activity',
      '1 selected activity — waterfall stop or tree planting',
      'Group itinerary',
    ],
    // RESTORED: also lost in the placeholder version.
    includedActivities: 1,
    coversActivityIds: ['waterfall', 'tree-planting'],
  },
];

// ── Add-on activities ───────────────────────────────────────────────────────

export const ACTIVITIES: HikeActivity[] = [
  {
    id: 'waterfall',
    name: 'Waterfall rest stop',
    price: 350,
    icon: 'water-outline',
  },
  {
    id: 'tree-planting',
    name: 'Tree planting',
    price: 250,
    icon: 'leaf-outline',
  },
  {
    id: 'canyoneering',
    name: 'Canyoneering',
    price: 2500,
    // The rate sheet says "depends on location" and "per person". Say so in
    // the UI rather than quoting ₱2,500 as though it were final.
    note: 'Canyoneering is a starting rate of ₱2,500 per person. The final '
      + 'price depends on the site and is confirmed by your guide.',
    icon: 'trail-sign-outline',
  },
];

// ── Guides ──────────────────────────────────────────────────────────────────

/**
 * SAMPLE GUIDE ROSTER — still placeholder data.
 *
 * These names and figures are invented so the flow can be demonstrated end to
 * end. They are not real accredited guides, and deliberately no photographs of
 * real people are used: the UI draws an initial in a circle, the same as the
 * review avatars.
 *
 * Replace with the real roster (or a Firestore `guides` collection) before
 * anyone can actually book a hike through this.
 */
export const GUIDES: Guide[] = [
  { id: 'g1', name: 'Ramon Santos', years: 12, summits: 300 },
  { id: 'g2', name: 'Liza Reyes', years: 8, summits: 180 },
  { id: 'g3', name: 'Joel Bautista', years: 5, summits: 90 },
];

// ── Merchandise ─────────────────────────────────────────────────────────────
// Location-specific designs provided by guides. Prices from the rate sheet.

export const MERCH: MerchItem[] = [
  { id: 'keychain', name: 'Keychains', price: 55, icon: 'key-outline' },
  { id: 'magnet', name: 'Magnets', price: 45, icon: 'magnet-outline' },
  { id: 'sticker', name: 'Stickers', price: 15, icon: 'pricetag-outline' },
  { id: 'patch', name: 'Patches', price: 25, icon: 'shield-outline' },
  { id: 'mug', name: 'Mugs', price: 60, icon: 'cafe-outline' },
];

// ── Lookups (used by BookingService) ────────────────────────────────────────

/** Always returns a package; falls back to the first one for an unknown id. */
export function packageById(id: PackageId): HikePackage {
  return PACKAGES.find(p => p.id === id) ?? PACKAGES[0];
}

export function activityById(id: string): HikeActivity | undefined {
  return ACTIVITIES.find(a => a.id === id);
}

/** `null` means "no preference", so there is no guide to look up. */
export function guideById(id: string | null): Guide | undefined {
  return id ? GUIDES.find(g => g.id === id) : undefined;
}

export function merchById(id: string): MerchItem | undefined {
  return MERCH.find(m => m.id === id);
}