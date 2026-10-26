/**
 * Guide availability, capacity and mountain assignments, as the booking page
 * sees them.
 *
 * Read-only and live: when a guide switches to Unavailable on /guide, the
 * booking page stops offering them straight away. guide_status is public
 * read in firestore.rules, so this works for signed-out visitors too.
 *
 * If the read fails (rules not published yet, offline), every guide reads as
 * available with no limit — the same as before guide_status existed — rather
 * than blocking every booking.
 */
import { Injectable, signal } from '@angular/core';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase.client';
import { asDate } from './notification.util';
import {
  DEFAULT_GUIDE_STATUS, type GuideStatus, type GuideTrails, guideCanLead, toGuideStatus, toGuideTrails,
} from '../models/guide-ops.model';

@Injectable({ providedIn: 'root' })
export class GuideStatusService {
  private readonly _byGuide = signal<Record<string, GuideStatus>>({});
  /** Mountains each guide is assigned to (guide_trails). Missing = not restricted. */
  private readonly _trails = signal<Record<string, string[]>>({});

  constructor() {
    onSnapshot(
      collection(db, 'guide_status'),
      (snap) => {
        const map: Record<string, GuideStatus> = {};
        for (const d of snap.docs) map[d.id] = toGuideStatus(d.data({ serverTimestamps: 'estimate' }), asDate);
        this._byGuide.set(map);
      },
      (err) => console.warn('Could not read guide availability; treating every guide as available.', err),
    );

    // Same fallback: if this read fails, no guide is restricted to particular
    // mountains, which is how the booking page behaved before.
    onSnapshot(
      collection(db, 'guide_trails'),
      (snap) => {
        const map: Record<string, string[]> = {};
        for (const d of snap.docs) {
          const ids = toGuideTrails(d.data());
          if (ids) map[d.id] = ids;
        }
        this._trails.set(map);
      },
      (err) => console.warn('Could not read guide mountain assignments; showing every guide.', err),
    );
  }

  /** The mountains this guide is assigned to, or null when not restricted. */
  trailsFor(guideId: string): GuideTrails {
    return this._trails()[guideId] ?? null;
  }

  /** Whether this guide may be offered for this mountain. Reactive. */
  canLead(guideId: string, trailId: string): boolean {
    return guideCanLead(this.trailsFor(guideId), trailId);
  }

  /** This guide's status. Reactive when read in a template or computed. */
  statusFor(guideId: string): GuideStatus {
    return this._byGuide()[guideId] ?? DEFAULT_GUIDE_STATUS;
  }
}
