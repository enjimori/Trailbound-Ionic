/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GUIDE OPERATIONS — availability, capacity and attendance
 *
 * Firestore (both new, both covered by firestore.rules):
 *
 *   guide_status/{rosterId}   { available, maxGuests, updatedAt, updatedBy }
 *                             Set by the guide on /guide. Public read, so the
 *                             booking page can respect it for guests too.
 *                             No document = available, no limit — exactly
 *                             how bookings behaved before this existed.
 *
 *   attendance/{bookingId}    { bookingId, uid, guideId, reference, trailName,
 *                               date, entries, recordedBy, updatedAt }
 *                             One per booking, written only by the guide the
 *                             booking is assigned to. Admins read it; nobody
 *                             else can read or change it.
 *
 *   guide_trails/{rosterId}   { trailIds, updatedAt, updatedBy }
 *                             Which mountains this guide is assigned to lead.
 *                             Set by an admin (Admin → Packages → Guides).
 *                             Public read, so the booking page only offers a
 *                             guide on their own mountains. No document =
 *                             not restricted yet (offered on every mountain,
 *                             as before), so nothing changes until an admin
 *                             assigns them.
 *
 * A booking's participants are its group hikers when it has them (the group
 * list includes the person who booked), otherwise the one hiker who booked.
 * Each participant is keyed p0, p1… by position, which is stable because a
 * booking's group list is never edited after checkout.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { GroupHiker } from './booking.model';
import { MAX_GROUP_HIKERS } from './booking.model';

// ── availability & capacity ─────────────────────────────────────────────────

export interface GuideStatus {
  available: boolean;
  /** Most hikers this guide will take on one hike date. null = no limit set. */
  maxGuests: number | null;
  updatedAt: Date | null;
}

/** What a guide is treated as until they save a setting. */
export const DEFAULT_GUIDE_STATUS: GuideStatus = { available: true, maxGuests: null, updatedAt: null };

/** Largest capacity a guide can set — the same ceiling as a group booking. */
export const MAX_GUIDE_GUESTS = MAX_GROUP_HIKERS;

/** How many people a booking brings. */
export function guestCount(groupHikers: GroupHiker[] | null | undefined): number {
  return Math.max(1, groupHikers?.length ?? 0);
}

/**
 * Why this guide cannot take these guests, or null when they can.
 *
 * `alreadyBooked` is everyone else this guide is already committed to on the
 * same date. The hiker app cannot see other hikers' bookings, so it passes 0
 * and checks the group size alone; the admin panel passes the real number.
 */
export function guideBlockReason(
  name: string,
  status: GuideStatus,
  guests: number,
  alreadyBooked = 0,
): string | null {
  if (!status.available) return `${name} is not available right now.`;
  const max = status.maxGuests;
  if (max === null) return null;
  if (guests > max) {
    return `${name} takes up to ${max} ${max === 1 ? 'hiker' : 'hikers'} per hike.`;
  }
  if (alreadyBooked + guests > max) {
    const left = Math.max(0, max - alreadyBooked);
    return `${name} has ${left} of ${max} ${max === 1 ? 'place' : 'places'} left that day.`;
  }
  return null;
}

// ── guide-to-mountain assignment ────────────────────────────────────────────

/**
 * The mountains a guide is assigned to, by trail id, or null when an admin
 * has not restricted them (they may guide any mountain, as before).
 */
export type GuideTrails = string[] | null;

/** Whether this guide may lead this mountain. */
export function guideCanLead(assigned: GuideTrails, trailId: string): boolean {
  return assigned === null || assigned.includes(trailId);
}

/** Why this guide cannot lead this mountain, or null when they can. */
export function guideTrailReason(name: string, assigned: GuideTrails, trailId: string, trailName: string): string | null {
  return guideCanLead(assigned, trailId) ? null : `${name} is not assigned to guide ${trailName || 'this mountain'}.`;
}

/** Reads one guide_trails document. A missing or malformed one = not restricted. */
export function toGuideTrails(d: Record<string, any> | undefined): GuideTrails {
  const ids = d?.['trailIds'];
  return Array.isArray(ids) ? ids.map(String) : null;
}

// ── participants & attendance ───────────────────────────────────────────────

export type AttendanceMark = 'present' | 'absent';

export interface Participant {
  /** p0, p1… */
  key: string;
  name: string;
  /** Emergency contact, for group hikers. */
  contact: string;
}

/** Who the guide is responsible for on this booking. */
export function participantsOf(b: { userName?: string | null; groupHikers?: GroupHiker[] | null }): Participant[] {
  const group = b.groupHikers ?? [];
  if (group.length) {
    return group.map((h, i) => ({
      key: `p${i}`,
      name: h.name?.trim() || `Hiker ${i + 1}`,
      contact: [h.emergencyContactName, h.emergencyContactPhone].filter(Boolean).join(' · '),
    }));
  }
  return [{ key: 'p0', name: b.userName?.trim() || 'Hiker', contact: '' }];
}

export interface AttendanceEntry {
  name: string;
  status: AttendanceMark;
}

export interface AttendanceRecord {
  bookingId: string;
  uid: string;
  guideId: string;
  reference: string;
  trailName: string;
  date: string;
  entries: Record<string, AttendanceEntry>;
  recordedBy: string;
  updatedAt: Date | null;
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  total: number;
}

/** Counted from the entries themselves, so it can never disagree with them. */
export function summarize(record: AttendanceRecord | null | undefined): AttendanceSummary {
  const list = Object.values(record?.entries ?? {});
  const present = list.filter((e) => e.status === 'present').length;
  const absent = list.filter((e) => e.status === 'absent').length;
  return { present, absent, total: list.length };
}

/** Reads one attendance document, tolerating anything malformed. */
export function toAttendance(id: string, d: Record<string, any>, toDate: (v: unknown) => Date | null): AttendanceRecord {
  const raw = (d['entries'] ?? {}) as Record<string, any>;
  const entries: Record<string, AttendanceEntry> = {};
  for (const [k, v] of Object.entries(raw)) {
    const status = v?.['status'];
    if (status === 'present' || status === 'absent') {
      entries[k] = { name: String(v?.['name'] ?? ''), status };
    }
  }
  return {
    bookingId: String(d['bookingId'] ?? id),
    uid: String(d['uid'] ?? ''),
    guideId: String(d['guideId'] ?? ''),
    reference: String(d['reference'] ?? ''),
    trailName: String(d['trailName'] ?? ''),
    date: String(d['date'] ?? ''),
    entries,
    recordedBy: String(d['recordedBy'] ?? ''),
    updatedAt: toDate(d['updatedAt']),
  };
}

/** Reads one guide_status document. */
export function toGuideStatus(d: Record<string, any> | undefined, toDate: (v: unknown) => Date | null): GuideStatus {
  if (!d) return { ...DEFAULT_GUIDE_STATUS };
  const max = Number(d['maxGuests']);
  return {
    available: d['available'] !== false,
    maxGuests: Number.isInteger(max) && max >= 1 ? max : null,
    updatedAt: toDate(d['updatedAt']),
  };
}
