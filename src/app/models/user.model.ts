/**
 * Shared user and upcoming-adventure contracts: keep profile data consistent between account services and profile screens.
 */

export interface UpcomingAdventure {
  id: string;
  trailId: string;
  name: string;
  image: string;
  date: string;
  duration: string;
  /**
   * 'wishlist' = saved with a heart (trail page, Home cards, Explore).
   * Older entries have no kind; see isWishlistEntry() for how they are read.
   */
  kind?: 'wishlist';
}

/** Date text every hearted trail is saved with (also what older saves used). */
export const WISHLIST_DATE = 'To be scheduled';

/**
 * True for a trail the hiker hearted.
 *
 * The same `upcoming` list in users/{uid} used to also hold a copy of every
 * booking (checkout wrote one, with the hike date). Those copies are not
 * hearts, so they are skipped: a heart entry is marked kind 'wishlist', and
 * older heart entries are recognised by the placeholder date they were saved
 * with. Bookings live in the Bookings tab.
 */
export function isWishlistEntry(a: { kind?: string; date?: string } | null | undefined): boolean {
  if (!a) return false;
  return a.kind === 'wishlist' || (!a.kind && a.date === WISHLIST_DATE);
}

export interface UserProfile {
  name: string;
  location: string;
  bio: string;
  avatar: string;
  totalHikes: number;
  totalDistanceKm: number;
  highestPeakM: number;
  email: string;
  phone: string;
  dob: string;
  gender: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
}
