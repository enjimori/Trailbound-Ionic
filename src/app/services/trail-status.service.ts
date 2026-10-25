import { Injectable, signal } from '@angular/core';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase.client';

/**
 * Which trails an admin has closed for booking, and why.
 *
 * Read from Firestore  trail_status/{trailId}  = { status: 'open' | 'closed',
 * note, updatedAt }, written from Admin → Trails. A trail with no document is
 * open. Streams live, so closing a trail in the admin panel switches off its
 * Book button on hikers' phones straight away.
 */
export interface TrailClosure {
  closed: boolean;
  note: string;
}

@Injectable({ providedIn: 'root' })
export class TrailStatusService {
  private readonly _closures = signal<Record<string, TrailClosure>>({});
  readonly closures = this._closures.asReadonly();

  constructor() {
    onSnapshot(
      collection(db, 'trail_status'),
      snap => {
        const map: Record<string, TrailClosure> = {};
        for (const d of snap.docs) {
          const data = d.data();
          if (data['status'] === 'closed') {
            map[d.id] = { closed: true, note: String(data['note'] ?? '') };
          }
        }
        this._closures.set(map);
      },
      err => console.warn('Could not read trail status.', err),
    );
  }

  /** Performs the closure for operation for this feature and returns its result to the caller. */
  closureFor(trailId: string): TrailClosure | null {
    return this._closures()[trailId] ?? null;
  }
}
