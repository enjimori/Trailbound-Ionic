import { Injectable, computed, signal } from '@angular/core';
import { deleteDoc, doc, onSnapshot, setDoc, collection } from 'firebase/firestore';
import { auth, db } from './firebase.client';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REVIEW SERVICE
 *
 * Real reviews written by whoever is using the app, persisted to
 * localStorage. Starts empty on a fresh install.
 *
 * WHY THERE IS NO SEED DATA HERE
 * These are real mountains. Inventing "Sofia Vergara gave Mt. Pulag five
 * stars" puts words in a real person's mouth and gives users a rating no one
 * actually awarded — the same problem as a fabricated trail route, just
 * quieter. A working review flow with an honest empty state demos better than
 * fake testimonials, and it is one less thing to strip out before release.
 *
 * When the team wires up Firestore, swap the two localStorage calls for reads
 * and writes against a `reviews` collection. Nothing else needs to change,
 * because every page reads through the signals below.
 *
 * FIRESTORE (added for the admin panel)
 *   A review written by a signed-in hiker is also saved to  reviews/{id},
 *   and every review in that collection is streamed back in. So reviews are
 *   now shared between hikers, the admin panel can see and remove them, and
 *   one an admin removes disappears here too. A guest's review still stays
 *   on their device only, exactly as before.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface TrailReview {
  id: string;
  trailId: string;
  author: string;
  /** Whole stars, 1 to 5. */
  rating: number;
  text: string;
  /** ISO timestamp, so it can be sorted and formatted per locale. */
  createdAt: string;
  /** Firebase uid of the hiker who wrote it (absent for a guest's review). */
  uid?: string;
  /** Internal: this review has reached Firestore. */
  synced?: boolean;
}

const STORAGE_KEY = 'TrailBound.reviews.v1';

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly _reviews = signal<TrailReview[]>(this.load());

  readonly reviews = computed(() => this._reviews());

  constructor() {
    onSnapshot(
      collection(db, 'reviews'),
      snap => {
        const remote = snap.docs.map(d => ({ ...(d.data() as TrailReview), id: d.id, synced: true }));
        const remoteIds = new Set(remote.map(r => r.id));
        // Keep local reviews that never reached the server (guest reviews,
        // or ones written offline). Synced ones missing from the server were
        // removed by an admin, so they go.
        const localOnly = this._reviews().filter(r => !r.synced && !remoteIds.has(r.id));
        this._reviews.set([...remote, ...localOnly]);
        this.save();
      },
      err => console.warn('Could not read reviews from Firestore.', err),
    );
  }

  /** Whether the person using the app may delete this review. */
  canDelete(r: TrailReview): boolean {
    return !r.uid || r.uid === auth.currentUser?.uid;
  }

  /** Reviews for one trail, newest first. */
  forTrail(trailId: string): TrailReview[] {
    return this._reviews()
      .filter(r => r.trailId === trailId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Average rating for a trail, or 0 when it has none yet. */
  averageFor(trailId: string): number {
    const list = this.forTrail(trailId);
    if (!list.length) return 0;
    const sum = list.reduce((acc, r) => acc + r.rating, 0);
    return Math.round((sum / list.length) * 10) / 10;
  }

  /** Performs the count for operation for this feature and returns its result to the caller. */
  countFor(trailId: string): number {
    return this.forTrail(trailId).length;
  }

  /** Creates a trail review, saves it, and updates the shared review list. */
  add(trailId: string, author: string, rating: number, text: string) {
    const review: TrailReview = {
      // Random suffix: reviews are shared now, so two hikers posting in the
      // same millisecond must not get the same id.
      id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6),
      trailId,
      author: author.trim() || 'Anonymous',
      // Clamp rather than trust the caller — a 7-star review would quietly
      // skew every average that reads it.
      rating: Math.min(5, Math.max(1, Math.round(rating))),
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    const uid = auth.currentUser?.uid;
    if (uid) review.uid = uid;

    this._reviews.update(list => [review, ...list]);
    this.save();

    if (uid) {
      const { synced, ...data } = review;
      void synced;
      setDoc(doc(db, 'reviews', review.id), data)
        .then(() => {
          this._reviews.update(list => list.map(r => (r.id === review.id ? { ...r, synced: true } : r)));
          this.save();
        })
        .catch(e => console.warn('Review saved on this device only.', e));
    }
  }

  /** Removes the selected record through the owning service and refreshes the view. */
  remove(id: string) {
    const review = this._reviews().find(r => r.id === id);
    this._reviews.update(list => list.filter(r => r.id !== id));
    this.save();
    if (review?.synced) {
      deleteDoc(doc(db, 'reviews', id)).catch(e => console.warn('Could not delete review.', e));
    }
  }

  /** Relative time for display: "2 days ago". */
  timeAgo(iso: string): string {
    const then = new Date(iso).getTime();
    const mins = Math.floor((Date.now() - then) / 60000);

    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;

    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;

    const months = Math.floor(days / 30);
    return months === 1 ? 'a month ago' : `${months} months ago`;
  }

  // ── persistence ─────────────────────────────────────────────────────────

  /**
   * localStorage throws in private browsing and when site data is blocked,
   * so both ends are wrapped. A failed read or write costs the reviews, not
   * the page.
   */
  private load(): TrailReview[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /** Persists the current changes through the owning service and updates saved state. */
  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._reviews()));
    } catch {
      // Storage unavailable — reviews stay for this session only.
    }
  }
}
