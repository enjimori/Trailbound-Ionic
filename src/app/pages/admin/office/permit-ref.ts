/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PERMIT REFERENCE
 *
 * A fallback reference for offices that have no numbering of their own.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 * This does not issue a permit, and a code it produces is not a permit number
 * from DENR, an LGU or a barangay. TrailBound records what an authorised
 * office granted; it has no authority to grant anything, and a generated code
 * presented as an official one would be a forgery however neatly it is
 * formatted.
 *
 * So the officer's own number always wins. This only pre-fills the box, and
 * anything downstream that shows a generated code labels it as TrailBound's
 * own reference. isGenerated() is how the rest of the app tells the two apart
 * without storing an extra field: the code is deterministic, so recomputing it
 * from the booking and comparing is enough.
 *
 * ── FORMAT ────────────────────────────────────────────────────────────────
 *   TB-2610-74965
 *      │    └── the booking's own reference digits (HIK-74965)
 *      └─────── year and month of the hike
 *
 * Deterministic, so two offices can never generate the same code for
 * different bookings and the same booking always produces the same code. No
 * randomness, nothing to collide, and anyone holding the code can find the
 * booking it belongs to.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * A reference for this booking, or '' when there is not enough to build one.
 *
 * @param reference  the booking's own reference, e.g. 'HIK-74965'
 * @param date       the hike date, yyyy-mm-dd
 */
export function suggestedPermitRef(reference: string, date: string): string {
  const digits = (reference ?? '').replace(/\D/g, '');
  const m = /^(\d{4})-(\d{2})/.exec(date ?? '');
  if (!digits || !m) return '';
  return `TB-${m[1].slice(2)}${m[2]}-${digits}`;
}

/**
 * Whether a recorded reference is one TrailBound generated rather than one an
 * office supplied.
 *
 * Recomputing and comparing rather than storing a flag keeps this out of the
 * Firestore document — and out of the list of fields the permit-office rule
 * allows an officer to write, which is a list worth keeping as short as it
 * can be.
 */
export function isGeneratedRef(permitRef: string | null, reference: string, date: string): boolean {
  if (!permitRef) return false;
  const suggested = suggestedPermitRef(reference, date);
  return !!suggested && permitRef.trim().toUpperCase() === suggested;
}
