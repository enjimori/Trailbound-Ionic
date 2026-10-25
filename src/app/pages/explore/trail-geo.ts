import { Trail } from '../../models/trail.model';
import { TRAILS_30 } from './explore-trails.data';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EXPLORE-MODULE GEO HELPERS
 *
 * Built-in trail coordinates are derived from explore-trails.data.ts. Added
 * trails carry their own coordinates from the admin catalog and use the same
 * helpers, so markers and directions work for both sources.
 *
 * Nothing here modifies trail.model.ts or trail.service.ts.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A trail that is known to have coordinates. Local to Explore. */
export type MappedTrail = Trail & LatLng;

/** Coordinates keyed by trail id, derived from the dataset. */
export const TRAIL_GEO: Record<string, LatLng> = Object.fromEntries(
  TRAILS_30.map(t => [t.id, { lat: t.lat, lng: t.lng }]),
);

/** Coordinates for a single trail id, or undefined if none are recorded. */
export function geoFor(id: string, trail?: Trail): LatLng | undefined {
  const lat = trail?.lat;
  const lng = trail?.lng;
  if (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
  ) {
    return { lat, lng };
  }
  return TRAIL_GEO[id];
}

/**
 * Joins coordinates onto trails. Trails with no entry are dropped rather than
 * defaulted — a marker at 0,0 in the Gulf of Guinea is worse than no marker.
 */
export function withGeo(trails: readonly Trail[]): MappedTrail[] {
  return trails.reduce<MappedTrail[]>((acc, t) => {
    const geo = geoFor(t.id, t);
    if (geo) acc.push({ ...t, ...geo });
    return acc;
  }, []);
}

/** Ids present in the list but missing coordinates. Logged in dev. */
export function missingGeo(trails: readonly Trail[]): string[] {
  return trails.filter(t => !geoFor(t.id, t)).map(t => t.id);
}

/**
 * The shared model has typed `status` as both a plain string ('OPEN'/'CLOSED')
 * and a lowercase union across different revisions of this repo. Compare
 * through this rather than `t.status === 'closed'` so the red marker state
 * fires whichever casing the data uses.
 */
export function isClosed(trail: Trail): boolean {
  return String(trail.status).toLowerCase() === 'closed';
}