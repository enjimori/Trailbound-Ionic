/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PER-TRAIL PERMIT AND DOCUMENT REQUIREMENTS
 *
 * Which office issues the permit for each mountain, what it costs, and whether
 * a medical certificate is required.
 *
 * A side table keyed off the trail, like trail-geo.ts and trail-videos.ts, so
 * the shared Trail model never grows fields and nobody else's file has to
 * change.
 *
 * ── WHY THIS IS NOT DERIVED FROM DIFFICULTY ───────────────────────────────
 * It is tempting to say "hard trails need a medical certificate". The real
 * data says otherwise. Mt. Pulag requires one because the DENR park
 * superintendent says so. Pico de Loro — which has the stricter booking system
 * of the two, with mandatory online registration and walk-ins turned away —
 * requires no certificate at all. The requirement follows the mountain's
 * managing office, not its grade.
 *
 * ── WHAT IS AND IS NOT CONFIRMED ──────────────────────────────────────────
 * Three trails below are set from published sources and carry verified: true.
 * The other twenty-seven fall back to UNVERIFIED, which the UI must show as
 * indicative rather than as fact. Inventing a permit office for a real
 * mountain would be worse than admitting the gap: a hiker who turns up at the
 * wrong office has been actively misled.
 *
 * To confirm one: ring the Protected Area Superintendent's office for a
 * protected area, or the municipal tourism office otherwise, then add an entry
 * and flip verified to true.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Who grants permission to climb. */
export type PermitAuthority =
  /** Protected Area Superintendent / PAMO, under the PAMB (E-NIPAS Act). */
  | 'denr'
  /** Municipal or city tourism office. */
  | 'lgu'
  /** The barangay at the jump-off, usually with an ecotourism fee. */
  | 'barangay'
  /** Landowner or caretaker, where the trail crosses private land. */
  | 'private'
  /** Open access, nothing to register. */
  | 'none';

export interface TrailPermit {
  authority: PermitAuthority;
  /** The office as a hiker would need to name it. */
  office: string;
  /**
   * Permit or entrance fee per hiker, in pesos. null means not published —
   * the deposit then covers the transaction fee only and admin quotes the
   * rest after lodging. Never guess a number here.
   */
  fee: number | null;
  /** Official booking portal, where the office runs one. */
  url?: string;
  /** Whether the office requires a doctor's clearance. */
  requiresMedical: boolean;
  /** Minimum age the office enforces, where it publishes one. */
  minAge?: number;
  /**
   * True only where the two fields above come from a published source.
   * False means the entry is a reasonable default, and the UI must say so.
   */
  verified: boolean;
  /** Anything a hiker should know before booking. */
  note?: string;
}

/**
 * The conservative default for a trail nobody has confirmed yet: assume a
 * local registration desk, assume no medical certificate, and mark it
 * unverified so every screen that shows it can say "to be confirmed".
 */
export const UNVERIFIED: TrailPermit = {
  authority: 'lgu',
  office: 'Local tourism office — to be confirmed',
  fee: null,
  requiresMedical: false,
  verified: false,
  note: 'Requirements for this trail have not been confirmed with the managing office yet.',
};

/**
 * Confirmed entries, matched on the trail's name rather than its id.
 *
 * Name matching rather than T001-style ids on purpose: the ids live in
 * explore-trails.data.ts, which is shared with the rest of the team, and an id
 * that silently stops matching after a reshuffle would attach Pulag's medical
 * requirement to the wrong mountain. A name match either works or visibly
 * does not.
 *
 * Patterns are deliberately loose — /pulag/i catches "Mt. Pulag",
 * "Mount Pulag" and "Mt Pulag" alike.
 */
const CONFIRMED: { match: RegExp; permit: TrailPermit }[] = [
  {
    match: /pulag/i,
    permit: {
      authority: 'denr',
      office: 'Mt. Pulag National Park — Protected Area Superintendent',
      // The park publishes fees in several tiers and has changed them; ask
      // the PASu office rather than printing a number that may be wrong.
      fee: null,
      requiresMedical: true,
      verified: true,
      note:
        'A medical certificate from a licensed physician is mandatory, attesting fitness ' +
        'for strenuous activity. Confirmed by the park superintendent.',
    },
  },
  {
    match: /pico de loro|palay.?palay/i,
    permit: {
      authority: 'denr',
      office: 'Mts. Palay-Palay / Mataas na Gulod Protected Landscape — PAMO',
      fee: 200, // local hiker; foreign nationals pay more
      url: 'https://mppmngnp.com',
      requiresMedical: false,
      minAge: 17,
      verified: true,
      note:
        'Online booking through the park\'s own portal is mandatory and walk-ins are ' +
        'turned away at the gate. TrailBound books on the hiker\'s behalf and records the ' +
        'reference; it cannot issue this permit itself.',
    },
  },
  {
    match: /batulao/i,
    permit: {
      authority: 'barangay',
      office: 'Barangay registration at the jump-off, Nasugbu, Batangas',
      fee: 140, // barangay and ecotourism fee, collected on arrival
      requiresMedical: false,
      verified: true,
      note: 'Registration and fees are collected at the jump-off on the day.',
    },
  },
];

/**
 * The permit rules for a trail. Pass the trail's name — every caller has the
 * trail object already, and this never needs the id.
 *
 * Always returns something, so no screen has to handle a missing entry. Check
 * `.verified` before presenting any of it as fact.
 */
export function permitFor(trailName: string | null | undefined): TrailPermit {
  const name = (trailName ?? '').trim();
  if (!name) return UNVERIFIED;
  return CONFIRMED.find((c) => c.match.test(name))?.permit ?? UNVERIFIED;
}

/** Convenience: does this trail need a doctor's clearance before booking? */
export function requiresMedical(trailName: string | null | undefined): boolean {
  return permitFor(trailName).requiresMedical;
}

/**
 * The per-hiker permit fee, or 0 when the office has not published one.
 * Used by the deposit calculation, which must never add null to a total.
 */
export function permitFeeFor(trailName: string | null | undefined): number {
  return permitFor(trailName).fee ?? 0;
}

/** How to label the authority on screen. */
export function authorityLabel(a: PermitAuthority): string {
  switch (a) {
    case 'denr':
      return 'DENR protected area';
    case 'lgu':
      return 'Municipal tourism office';
    case 'barangay':
      return 'Barangay';
    case 'private':
      return 'Private land';
    case 'none':
      return 'No permit required';
  }
}
