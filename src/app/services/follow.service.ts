import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  Unsubscribe, collection, deleteDoc, doc, getCountFromServer, getDocs, limit,
  onSnapshot, query, serverTimestamp, setDoc, where,
} from 'firebase/firestore';
import { auth, db } from './firebase.client';
import { UserService } from './user.service';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FOLLOW SERVICE — who follows whom (no messaging)
 *
 *   follows/{followerUid}_{followeeUid}   { followerUid, followeeUid, createdAt }
 *   profiles/{uid}                        { name, avatar }  (public, already exists)
 *
 * The document id is built from both uids, so a pair can only exist once, and
 * firestore.rules only lets you create / delete follows where YOU are the
 * follower. Your own following + followers lists stream live; counts for other
 * people are fetched on demand.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface PersonSummary {
  uid: string;
  name: string;
  /** Small photo data URL, or '' for the default avatar. */
  avatar: string;
  /** Short bio from their public profile, or '' if they haven't written one. */
  bio?: string;
}

/** Profiles loaded for search. Beyond this, swap to a server-side search. */
const DIRECTORY_MAX = 500;

@Injectable({ providedIn: 'root' })
export class FollowService {
  private readonly userService = inject(UserService);

  private readonly _following = signal<Set<string>>(new Set());
  /** When you started following each person (ms). Used so only NEW posts alert you. */
  private readonly _followedAt = signal<Map<string, number>>(new Map());
  private readonly _followers = signal<Set<string>>(new Set());
  /** uids with a follow/unfollow still being sent — keeps buttons from double-firing. */
  private readonly _busy = signal<Set<string>>(new Set());

  readonly followingUids = this._following.asReadonly();
  readonly followedAt = this._followedAt.asReadonly();
  readonly followerUids = this._followers.asReadonly();
  readonly followingCount = computed(() => this._following().size);
  readonly followerCount = computed(() => this._followers().size);

  readonly myUid = computed(() =>
    this.userService.isAuthenticated() ? (auth.currentUser?.uid ?? null) : null,
  );

  private unsubs: Unsubscribe[] = [];

  // ── search directory (loaded once per session) ──────────────────────────
  private directory: PersonSummary[] | null = null;
  private directoryLoad: Promise<PersonSummary[]> | null = null;

  constructor() {
    // Start / stop the live lists as people sign in and out.
    // untracked: older Angular versions refuse signal writes inside an effect.
    effect(() => {
      const uid = this.myUid();
      untracked(() => this.watch(uid));
    });
  }

  /** Checks whether the current user follows the supplied account. */
  isFollowing(uid: string): boolean {
    return this._following().has(uid);
  }

  /** Checks whether a follow or unfollow request is currently in progress. */
  isBusy(uid: string): boolean {
    return this._busy().has(uid);
  }

  /** Follow or unfollow. The button updates at once and rolls back if the write fails. */
  async toggle(uid: string): Promise<'followed' | 'unfollowed'> {
    const me = this.myUid();
    if (!me) throw new Error('Please sign in first.');
    if (me === uid) throw new Error("You can't follow yourself.");
    if (this._busy().has(uid)) return this.isFollowing(uid) ? 'followed' : 'unfollowed';

    const wasFollowing = this.isFollowing(uid);
    this.setBusy(uid, true);
    this.setFollowing(uid, !wasFollowing);
    try {
      const ref = doc(db, 'follows', `${me}_${uid}`);
      if (wasFollowing) await deleteDoc(ref);
      else await setDoc(ref, { followerUid: me, followeeUid: uid, createdAt: serverTimestamp() });
      return wasFollowing ? 'unfollowed' : 'followed';
    } catch (e) {
      this.setFollowing(uid, wasFollowing);
      console.error('[follow] write failed', e);
      const code = (e as { code?: string }).code ?? '';
      throw new Error(
        code === 'permission-denied'
          ? "Not allowed by Firestore. Publish the latest firestore.ionic.rules (the 'follows' section)."
          : "Couldn't update. Check your connection and try again.",
      );
    } finally {
      this.setBusy(uid, false);
    }
  }

  /** Follower / following totals for anyone's profile. */
  async countsFor(uid: string): Promise<{ followers: number; following: number }> {
    try {
      const [a, b] = await Promise.all([
        getCountFromServer(query(collection(db, 'follows'), where('followeeUid', '==', uid))),
        getCountFromServer(query(collection(db, 'follows'), where('followerUid', '==', uid))),
      ]);
      return { followers: a.data().count, following: b.data().count };
    } catch {
      if (uid === this.myUid()) return { followers: this.followerCount(), following: this.followingCount() };
      return { followers: 0, following: 0 };
    }
  }

  /** Everyone with a public profile, for searching. Cached after the first call. */
  loadDirectory(force = false): Promise<PersonSummary[]> {
    if (this.directory && !force) return Promise.resolve(this.directory);
    if (this.directoryLoad && !force) return this.directoryLoad;
    this.directoryLoad = getDocs(query(collection(db, 'profiles'), limit(DIRECTORY_MAX)))
      .then((snap) => {
        this.directory = snap.docs.map((d) => {
          const data = d.data() as { name?: string; avatar?: string; bio?: string };
          return {
            uid: d.id,
            name: (data.name || 'Trail Hiker').trim(),
            avatar: data.avatar || '',
            bio: (data.bio || '').trim(),
          };
        });
        return this.directory;
      })
      .finally(() => (this.directoryLoad = null));
    return this.directoryLoad;
  }

  // ── internals ───────────────────────────────────────────────────────────

  private watch(uid: string | null) {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this._following.set(new Set());
    this._followedAt.set(new Map());
    this._followers.set(new Set());
    if (!uid) return;

    this.unsubs.push(
      onSnapshot(
        query(collection(db, 'follows'), where('followerUid', '==', uid)),
        (snap) => {
          const uids = new Set<string>();
          const at = new Map<string, number>();
          snap.docs.forEach((d) => {
            const data = d.data({ serverTimestamps: 'estimate' });
            const id = data['followeeUid'] as string;
            uids.add(id);
            const ts = data['createdAt'] as { toMillis?: () => number } | undefined;
            at.set(id, ts?.toMillis ? ts.toMillis() : (this._followedAt().get(id) ?? Date.now()));
          });
          this._following.set(uids);
          this._followedAt.set(at);
        },
        (err) => console.error('[follow] following list failed', err),
      ),
      onSnapshot(
        query(collection(db, 'follows'), where('followeeUid', '==', uid)),
        (snap) => this._followers.set(new Set(snap.docs.map((d) => d.data()['followerUid'] as string))),
        (err) => console.error('[follow] followers list failed', err),
      ),
    );
  }

  /** Stores the set following selection so the related view and feature logic stay in sync. */
  private setFollowing(uid: string, on: boolean) {
    this._following.update((s) => {
      const next = new Set(s);
      on ? next.add(uid) : next.delete(uid);
      return next;
    });
    this._followedAt.update((m) => {
      const next = new Map(m);
      on ? next.set(uid, Date.now()) : next.delete(uid);
      return next;
    });
  }

  /** Stores the set busy selection so the related view and feature logic stay in sync. */
  private setBusy(uid: string, on: boolean) {
    this._busy.update((s) => {
      const next = new Set(s);
      on ? next.add(uid) : next.delete(uid);
      return next;
    });
  }
}
