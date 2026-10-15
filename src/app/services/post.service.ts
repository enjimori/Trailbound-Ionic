import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  DocumentData, FirestoreError, Timestamp, Unsubscribe,
  addDoc, arrayRemove, arrayUnion, collection, deleteField, doc, getDoc, getDocs,
  increment, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase.client';
import { UserService } from './user.service';
import { Post, PostComment, PostDraft } from '../models/post.model';
import { makeAvatarThumb } from './photo.util';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST SERVICE — the community feed, stored in Firestore
 *
 *   posts/{postId}                     one post (text, photos, likes)
 *   posts/{postId}/comments/{id}       its comments
 *   profiles/{uid}                     public name + small photo of anyone
 *                                      who has posted or commented
 *
 * Every post and comment records the uid of the account that wrote it, and
 * firestore.rules refuses a write whose uid isn't the signed-in user — so a
 * post always shows the account that really made it.
 *
 * The author's name and photo are read from profiles/{uid} rather than copied
 * into each post, so changing your profile photo updates all of your old
 * posts and comments too. The name copied into the post (authorName) is only
 * a fallback for when the profile can't be read.
 *
 * Everything streams with onSnapshot, so a new post, like or comment from
 * another phone shows up without a refresh.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const POST_TEXT_MAX = 1000;
export const COMMENT_TEXT_MAX = 500;
export const POST_PHOTO_MAX = 4;

const PAGE_SIZE = 30;
/** Firestore caps a document at 1 MiB; leave room for field names and likes. */
const POST_CHARS_MAX = 960_000;
/** After this long without a server reply, stop the spinner — the write keeps going. */
const WRITE_TIMEOUT_MS = 20_000;
const DEFAULT_NAME = 'Trail Hiker';

interface PostDoc {
  authorUid: string;
  authorName?: string;
  text?: string;
  images?: string[];
  trailId?: string;
  trailName?: string;
  likedBy?: string[];
  commentCount?: number;
  createdAt?: Timestamp | null;
  editedAt?: Timestamp | null;
}

interface CommentDoc {
  authorUid: string;
  authorName?: string;
  text?: string;
  createdAt?: Timestamp | null;
}

interface PublicProfile {
  name: string;
  avatar: string;
}

/** Result of a write: confirmed by the server, or still uploading in the background. */
export type WriteResult = 'saved' | 'pending';

/** An error whose message is safe to show the user as-is. */
export class CommunityError extends Error {
  constructor(message: string, public code = '') {
    super(message);
  }
}

function friendlyError(e: unknown, fallback: string): CommunityError {
  if (e instanceof CommunityError) return e;
  const code = (e as FirestoreError)?.code ?? '';
  console.error('[community]', e);
  switch (code) {
    case 'permission-denied':
      return new CommunityError(
        'The server refused this. Make sure the latest firestore.rules are published in Firebase.',
        code,
      );
    case 'not-found':
      return new CommunityError('This post has been deleted.', code);
    case 'unavailable':
      return new CommunityError('You seem to be offline. Check your connection and try again.', code);
    case 'invalid-argument':
      return new CommunityError('That post is too large. Try removing a photo.', code);
    case 'unauthenticated':
      return new CommunityError('Please sign in again.', code);
    default:
      return new CommunityError(fallback, code);
  }
}

/** Resolves 'saved' when the server confirms, or 'pending' if it's taking too long. */
async function withTimeout(p: Promise<unknown>): Promise<WriteResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<WriteResult>((resolve) => {
    timer = setTimeout(() => resolve('pending'), WRITE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([p.then(() => 'saved' as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function toDate(ts: Timestamp | null | undefined): Date | null {
  return ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
}

/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function timeAgo(date: Date | null, now = Date.now()): string {
  if (!date) return 'just now';
  const mins = Math.floor((now - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

@Injectable({ providedIn: 'root' })
export class PostService {
  private readonly userService = inject(UserService);

  // ── raw Firestore state ─────────────────────────────────────────────────
  private readonly _postDocs = signal<{ id: string; data: PostDoc }[]>([]);
  private readonly _profiles = signal<Record<string, PublicProfile>>({});
  /** Ticks every minute so "5m ago" keeps counting without new data. */
  private readonly _now = signal(Date.now());
  private readonly _pageSize = signal(PAGE_SIZE);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly hasMore = signal(false);

  private feedUnsub?: Unsubscribe;
  private readonly profileUnsubs = new Map<string, Unsubscribe>();

  // ── who is signed in ────────────────────────────────────────────────────
  /** uid of the signed-in user, or null for guests. */
  readonly myUid = computed(() =>
    this.userService.isAuthenticated() ? (auth.currentUser?.uid ?? null) : null,
  );

  /** Name and photo the signed-in user posts with. */
  readonly me = computed(() => {
    const p = this.userService.profile();
    return { name: (p.name || '').trim() || DEFAULT_NAME, avatar: p.avatar || '' };
  });

  // ── the feed, as the pages see it ───────────────────────────────────────
  readonly posts = computed<Post[]>(() => {
    const now = this._now();
    const uid = this.myUid();
    const me = this.me();
    const profiles = this._profiles();

    return this._postDocs().map(({ id, data }) => {
      const mine = !!uid && data.authorUid === uid;
      const profile = profiles[data.authorUid];
      const likedBy = data.likedBy ?? [];
      const createdAt = toDate(data.createdAt);
      return {
        id,
        authorUid: data.authorUid,
        // Your own posts use your live profile, so edits show immediately.
        author: mine ? me.name : (profile?.name || data.authorName || DEFAULT_NAME),
        avatar: mine ? me.avatar : (profile?.avatar || ''),
        timeAgo: timeAgo(createdAt, now),
        createdAt,
        edited: !!data.editedAt,
        content: data.text ?? '',
        images: data.images ?? [],
        trailId: data.trailId || undefined,
        trailName: data.trailName || undefined,
        likes: likedBy.length,
        liked: !!uid && likedBy.includes(uid),
        commentCount: Math.max(0, data.commentCount ?? 0),
        isMine: mine,
      };
    });
  });

  // ── the open comment thread ─────────────────────────────────────────────
  private readonly _threadPostId = signal<string | null>(null);
  private readonly _commentDocs = signal<{ id: string; data: CommentDoc }[]>([]);
  readonly commentsLoading = signal(false);
  readonly commentsError = signal<string | null>(null);
  private commentsUnsub?: Unsubscribe;

  readonly threadPostId = this._threadPostId.asReadonly();

  readonly comments = computed<PostComment[]>(() => {
    const now = this._now();
    const uid = this.myUid();
    const me = this.me();
    const profiles = this._profiles();
    const postId = this._threadPostId();
    const postAuthor = this._postDocs().find((p) => p.id === postId)?.data.authorUid;

    return this._commentDocs().map(({ id, data }) => {
      const mine = !!uid && data.authorUid === uid;
      const profile = profiles[data.authorUid];
      const createdAt = toDate(data.createdAt);
      return {
        id,
        authorUid: data.authorUid,
        author: mine ? me.name : (profile?.name || data.authorName || DEFAULT_NAME),
        avatar: mine ? me.avatar : (profile?.avatar || ''),
        text: data.text ?? '',
        timeAgo: timeAgo(createdAt, now),
        createdAt,
        isMine: mine,
        isPostAuthor: !!postAuthor && data.authorUid === postAuthor,
      };
    });
  });

  constructor() {
    this.listenToFeed();
    setInterval(() => this._now.set(Date.now()), 60_000);

    // Keep the public profile in step with Personal Info (name / photo
    // changes), but only for people who have already joined the community.
    effect(() => {
      const uid = this.myUid();
      const me = this.me();
      untracked(() => this.queueProfileSync(uid, me));
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Feed
  // ═══════════════════════════════════════════════════════════════════════

  private listenToFeed() {
    this.feedUnsub?.();
    this.loadError.set(null);
    const size = this._pageSize();
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(size));

    this.feedUnsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({
          id: d.id,
          // A post you just sent has no server time yet; estimate it so it
          // sorts to the top and says "just now".
          data: d.data({ serverTimestamps: 'estimate' }) as PostDoc,
        }));
        this._postDocs.set(docs);
        this.hasMore.set(snap.size >= size);
        this.loading.set(false);
        this.loadError.set(null);
        docs.forEach((d) => this.watchProfile(d.data.authorUid));
      },
      (err) => {
        console.error('[community] feed listener failed', err);
        this.loading.set(false);
        this.loadError.set(
          err.code === 'permission-denied'
            ? 'Posts can\'t be read yet. Publish the latest firestore.rules in Firebase.'
            : 'Couldn\'t load posts. Check your connection and try again.',
        );
      },
    );
  }

  retry() {
    this.loading.set(true);
    this.listenToFeed();
  }

  loadMore() {
    this._pageSize.update((n) => n + PAGE_SIZE);
    this.listenToFeed();
  }

  /** Streams an author's public name + photo (once per author). */
  private watchProfile(uid: string | undefined) {
    if (!uid || this.profileUnsubs.has(uid)) return;
    const unsub = onSnapshot(
      doc(db, 'profiles', uid),
      (snap) => {
        const data = snap.data() as Partial<PublicProfile> | undefined;
        this._profiles.update((all) => {
          const next = { ...all };
          if (data) next[uid] = { name: data.name ?? '', avatar: data.avatar ?? '' };
          else delete next[uid];
          return next;
        });
      },
      // No profile access just means the name copied into the post is used.
      () => this.profileUnsubs.delete(uid),
    );
    this.profileUnsubs.set(uid, unsub);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Posts
  // ═══════════════════════════════════════════════════════════════════════

  async createPost(draft: PostDraft): Promise<WriteResult> {
    const uid = this.requireUid();
    const clean = this.validateDraft(draft);

    const payload: DocumentData = {
      authorUid: uid,
      authorName: this.publicName(),
      text: clean.text,
      images: clean.images,
      likedBy: [],
      commentCount: 0,
      createdAt: serverTimestamp(),
    };
    if (clean.trailId) {
      payload['trailId'] = clean.trailId;
      payload['trailName'] = clean.trailName ?? '';
    }
    this.checkSize(payload);

    void this.publishMyProfile();
    try {
      return await withTimeout(addDoc(collection(db, 'posts'), payload));
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t publish your post. Please try again.');
    }
  }

  async updatePost(postId: string, draft: PostDraft): Promise<WriteResult> {
    this.requireUid();
    const clean = this.validateDraft(draft);

    const payload: DocumentData = {
      authorName: this.publicName(),
      text: clean.text,
      images: clean.images,
      trailId: clean.trailId ? clean.trailId : deleteField(),
      trailName: clean.trailId ? (clean.trailName ?? '') : deleteField(),
      editedAt: serverTimestamp(),
    };
    this.checkSize({ ...payload, trailId: clean.trailId ?? '', trailName: clean.trailName ?? '' });

    try {
      return await withTimeout(updateDoc(doc(db, 'posts', postId), payload));
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t save your changes. Please try again.');
    }
  }

  /** Deletes a post and all of its comments. */
  async deletePost(postId: string): Promise<void> {
    this.requireUid();
    try {
      const comments = await getDocs(collection(db, 'posts', postId, 'comments'));
      const refs = comments.docs.map((d) => d.ref);
      // A batch holds at most 500 writes.
      for (let i = 0; i < refs.length; i += 450) {
        const batch = writeBatch(db);
        refs.slice(i, i + 450).forEach((r) => batch.delete(r));
        await batch.commit();
      }
      const last = writeBatch(db);
      last.delete(doc(db, 'posts', postId));
      await last.commit();
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t delete the post. Please try again.');
    }
  }

  async toggleLike(post: Post): Promise<void> {
    const uid = this.requireUid();
    try {
      await updateDoc(doc(db, 'posts', post.id), {
        likedBy: post.liked ? arrayRemove(uid) : arrayUnion(uid),
      });
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t update the like. Please try again.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Comments
  // ═══════════════════════════════════════════════════════════════════════

  /** Starts streaming one post's comments (closing any previous thread). */
  openThread(postId: string) {
    if (this._threadPostId() === postId && this.commentsUnsub) return;
    this.closeThread();
    this._threadPostId.set(postId);
    this.commentsLoading.set(true);
    this.commentsError.set(null);

    const q = query(
      collection(db, 'posts', postId, 'comments'),
      orderBy('createdAt', 'asc'),
      limit(300),
    );
    this.commentsUnsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({
          id: d.id,
          data: d.data({ serverTimestamps: 'estimate' }) as CommentDoc,
        }));
        this._commentDocs.set(docs);
        this.commentsLoading.set(false);
        docs.forEach((d) => this.watchProfile(d.data.authorUid));
      },
      (err) => {
        console.error('[community] comments listener failed', err);
        this.commentsLoading.set(false);
        this.commentsError.set('Couldn\'t load comments.');
      },
    );
  }

  closeThread() {
    this.commentsUnsub?.();
    this.commentsUnsub = undefined;
    this._threadPostId.set(null);
    this._commentDocs.set([]);
    this.commentsError.set(null);
  }

  async addComment(postId: string, text: string): Promise<WriteResult> {
    const uid = this.requireUid();
    const body = text.trim();
    if (!body) throw new CommunityError('Write something first.');
    if (body.length > COMMENT_TEXT_MAX) {
      throw new CommunityError(`Comments can be up to ${COMMENT_TEXT_MAX} characters.`);
    }

    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'posts', postId, 'comments')), {
      authorUid: uid,
      authorName: this.publicName(),
      text: body,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'posts', postId), { commentCount: increment(1) });

    void this.publishMyProfile();
    try {
      return await withTimeout(batch.commit());
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t post your comment. Please try again.');
    }
  }

  async deleteComment(postId: string, commentId: string): Promise<void> {
    this.requireUid();
    const batch = writeBatch(db);
    batch.delete(doc(db, 'posts', postId, 'comments', commentId));
    batch.update(doc(db, 'posts', postId), { commentCount: increment(-1) });
    try {
      await batch.commit();
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t delete the comment. Please try again.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Public profile (name + small photo shown to other users)
  // ═══════════════════════════════════════════════════════════════════════

  /** Fingerprint of what was last written to profiles/{uid}, to skip repeat writes. */
  private publishedKey: string | null = null;
  /** uid whose community membership has been checked this session. */
  private checkedUid: string | null = null;
  private profileSync: Promise<void> = Promise.resolve();

  private profileKey(me: { name: string; avatar: string }) {
    return `${me.name}|${me.avatar.length}|${me.avatar.slice(-48)}`;
  }

  private queueProfileSync(uid: string | null, me: { name: string; avatar: string }) {
    if (!uid) {
      this.publishedKey = null;
      this.checkedUid = null;
      return;
    }
    this.profileSync = this.profileSync
      .then(() => this.syncProfile(uid, me))
      .catch(() => {});
  }

  /**
   * People who have never posted or commented get no public profile. For
   * people who have, re-publish once per session and on every change.
   */
  private async syncProfile(uid: string, me: { name: string; avatar: string }) {
    if (this.myUid() !== uid) return;
    if (this.checkedUid !== uid) {
      this.checkedUid = uid;
      const snap = await getDoc(doc(db, 'profiles', uid));
      if (!snap.exists()) return;
      this.publishedKey = null; // force one refresh
    } else if (this.publishedKey === null) {
      return; // not a community member yet
    }
    if (this.profileKey(me) !== this.publishedKey) await this.publishMyProfile();
  }

  private async publishMyProfile(): Promise<void> {
    const uid = this.myUid();
    if (!uid) return;
    const me = this.me();
    const key = this.profileKey(me);
    if (key === this.publishedKey) return;
    try {
      const avatar = me.avatar ? await makeAvatarThumb(me.avatar).catch(() => '') : '';
      await setDoc(doc(db, 'profiles', uid), {
        name: this.publicName(),
        avatar,
        updatedAt: serverTimestamp(),
      });
      this.publishedKey = key;
      this.checkedUid = uid;
    } catch (e) {
      // Not fatal: posts fall back to the name stored in each post.
      console.warn('[community] could not publish public profile', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════════════════

  private publicName(): string {
    return this.me().name.slice(0, 60);
  }

  private requireUid(): string {
    const uid = this.myUid();
    if (!uid) throw new CommunityError('Please sign in first.', 'unauthenticated');
    return uid;
  }

  private validateDraft(draft: PostDraft): PostDraft {
    const text = (draft.text ?? '').trim();
    const images = (draft.images ?? []).slice(0, POST_PHOTO_MAX);
    if (!text && !images.length) throw new CommunityError('Write something or add a photo.');
    if (text.length > POST_TEXT_MAX) {
      throw new CommunityError(`Posts can be up to ${POST_TEXT_MAX} characters.`);
    }
    return { text, images, trailId: draft.trailId, trailName: draft.trailName };
  }

  private checkSize(payload: DocumentData) {
    const approx = JSON.stringify(payload).length;
    if (approx > POST_CHARS_MAX) {
      throw new CommunityError('Those photos are too large together. Remove one and try again.');
    }
  }
}
