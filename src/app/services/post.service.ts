/**
 * Community-post service: centralizes post and comment data operations used by the feed and reusable post components.
 */
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  DocumentData, FirestoreError, Timestamp, Unsubscribe,
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs,
  increment, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase.client';
import { UserService } from './user.service';
import { Post, PostComment, PostDraft, PostVersion } from '../models/post.model';
import { makeAvatarThumb } from './photo.util';
import { MentionRef, pruneMentions } from './mention.util';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST SERVICE — the community feed, stored in Firestore
 *
 *   posts/{postId}                     one post (text, photos, rating, votes)
 *                                      A repost is also a post doc, with
 *                                      repostOf = the original's id.
 *   posts/{postId}/comments/{id}       its comments
 *   posts/{postId}/history/{id}        a previous version of the post, saved
 *                                      each time its author edits it
 *   profiles/{uid}                     public name + small photo of anyone
 *                                      who has posted or commented
 *
 * A post can also carry guideUid / guideName: the person the author hiked
 * with ("Guided by …"). Their name and photo are read live from profiles.
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
const MENTIONS_MAX = 10;

/** Tidy a mention list before saving: valid entries only, still in the text, no repeats, capped. */
function cleanMentions(text: string, list?: MentionRef[]): MentionRef[] {
  const valid = (list ?? [])
    .filter((m) => m && typeof m.uid === 'string' && m.uid && typeof m.name === 'string' && m.name)
    .map((m) => ({ uid: m.uid, name: m.name.slice(0, 60) }));
  return pruneMentions(text, valid).slice(0, MENTIONS_MAX);
}

interface PostDoc {
  authorUid: string;
  authorName?: string;
  text?: string;
  images?: string[];
  trailId?: string;
  trailName?: string;
  /** uids who upvoted. (Named likedBy because it started life as the like list.) */
  likedBy?: string[];
  /** uids who downvoted. */
  downvotedBy?: string[];
  /** uids who reposted. */
  repostedBy?: string[];
  /** 1–5 stars for the tagged trail. */
  rating?: number;
  /** uid of the guide the author tagged, and their name as a fallback. */
  guideUid?: string;
  guideName?: string;
  /** People tagged with @ in the text. */
  mentions?: MentionRef[];
  /** Set on a repost: the id of the post being reposted. */
  repostOf?: string;
  commentCount?: number;
  createdAt?: Timestamp | null;
  editedAt?: Timestamp | null;
}

/** A past version of a post, written just before an edit replaces it. */
interface HistoryDoc {
  authorUid: string;
  text?: string;
  trailId?: string;
  trailName?: string;
  rating?: number;
  imageCount?: number;
  /** Only stored when the photos changed in the edit that replaced this version. */
  images?: string[];
  /** When this version became the live one. */
  savedAt?: Timestamp | null;
  /** When an edit replaced it. */
  replacedAt?: Timestamp | null;
}

interface CommentDoc {
  authorUid: string;
  authorName?: string;
  text?: string;
  mentions?: MentionRef[];
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

export function friendlyError(e: unknown, fallback: string): CommunityError {
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

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** "Oct 18, 2026, 3:42 PM" */
function formatWhen(date: Date | null): string {
  if (!date) return 'Just now';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
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
  /** Posts that reposts point at but that aren't in the loaded feed. null = deleted. */
  private readonly _originals = signal<Record<string, PostDoc | null>>({});
  /** Ticks every minute so "5m ago" keeps counting without new data. */
  private readonly _now = signal(Date.now());
  private readonly _pageSize = signal(PAGE_SIZE);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly hasMore = signal(false);

  private feedUnsub?: Unsubscribe;
  private readonly profileUnsubs = new Map<string, Unsubscribe>();
  private readonly originalUnsubs = new Map<string, Unsubscribe>();

  // ── who is signed in ────────────────────────────────────────────────────
  /** uid of the signed-in user, or null for guests. */
  readonly myUid = computed(() =>
    this.userService.isAuthenticated() ? (auth.currentUser?.uid ?? null) : null,
  );

  /** Name and photo the signed-in user posts with. */
  readonly me = computed(() => {
    const p = this.userService.profile();
    return {
      name: (p.name || '').trim() || DEFAULT_NAME,
      avatar: p.avatar || '',
      // Shown on your public profile when other hikers open it.
      bio: (p.bio || '').trim().slice(0, 160),
    };
  });

  // ── the feed, as the pages see it ───────────────────────────────────────
  readonly posts = computed<Post[]>(() => {
    const ctx = this.buildContext();
    const feed = this._postDocs();
    const originals = this._originals();
    const out: Post[] = [];

    for (const { id, data } of feed) {
      if (!data.repostOf) {
        out.push(this.buildPost(id, data, ctx));
        continue;
      }
      // A repost: show the original inside it. undefined = still loading.
      const origData = feed.find((p) => p.id === data.repostOf)?.data ?? originals[data.repostOf];
      if (origData === undefined) continue;
      const wrapper = this.buildPost(id, data, ctx);
      wrapper.isRepost = true;
      wrapper.original = origData ? this.buildPost(data.repostOf, origData, ctx) : null;
      out.push(wrapper);
    }
    return out;
  });

  /** Every post the screens can see, including originals inside reposts. */
  private readonly byId = computed(() => {
    const map = new Map<string, Post>();
    for (const p of this.posts()) {
      map.set(p.id, p);
      if (p.original) map.set(p.original.id, p.original);
    }
    return map;
  });

  /** Performs the post by id operation for this feature and returns its result to the caller. */
  postById(id: string | null | undefined): Post | null {
    return id ? this.byId().get(id) ?? null : null;
  }

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
    const postAuthor = this.docOf(postId)?.authorUid;

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
        mentions: data.mentions?.length ? data.mentions : undefined,
        timeAgo: timeAgo(createdAt, now),
        createdAt,
        isMine: mine,
        isPostAuthor: !!postAuthor && data.authorUid === postAuthor,
      };
    });
  });

  // ── the open edit history ───────────────────────────────────────────────
  private readonly _historyPostId = signal<string | null>(null);
  private readonly _historyDocs = signal<{ id: string; data: HistoryDoc }[]>([]);
  readonly historyLoading = signal(false);
  readonly historyError = signal<string | null>(null);
  private historyUnsub?: Unsubscribe;

  readonly historyPostId = this._historyPostId.asReadonly();

  /** Newest first: the current version, then each earlier one. */
  readonly versions = computed<PostVersion[]>(() => {
    const postId = this._historyPostId();
    const post = this.postById(postId);
    if (!post) return [];
    const raw = this.docOf(postId);
    const docs = this._historyDocs();

    const out: PostVersion[] = [{
      id: 'current',
      isCurrent: true,
      isOriginal: docs.length === 0,
      text: post.content,
      images: post.images,
      trailName: post.trailName,
      rating: post.rating,
      whenLabel: formatWhen(toDate(raw?.editedAt) ?? post.createdAt),
    }];

    // Photos are only stored on a history entry when they changed, so an
    // entry without them shows the same photos as the version that replaced it.
    let newerImages = post.images;
    docs.forEach(({ id, data }, i) => {
      const images = data.images ?? newerImages;
      out.push({
        id,
        isCurrent: false,
        isOriginal: i === docs.length - 1,
        text: data.text ?? '',
        images,
        trailName: data.trailName || undefined,
        rating: data.rating || undefined,
        whenLabel: formatWhen(toDate(data.savedAt)),
      });
      newerImages = images;
    });
    return out;
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
        docs.forEach((d) => {
          this.watchProfile(d.data.authorUid);
          this.watchProfile(d.data.guideUid);
          if (d.data.repostOf) this.watchOriginal(d.data.repostOf);
        });
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

  /** Retries the operation that previously failed and updates the displayed result. */
  retry() {
    this.loading.set(true);
    this.listenToFeed();
  }

  /** Fetches the next page of records and appends it to the current feed. */
  loadMore() {
    this._pageSize.update((n) => n + PAGE_SIZE);
    this.listenToFeed();
  }

  /** Streams the post a repost points at (once per post). */
  private watchOriginal(id: string) {
    if (this.originalUnsubs.has(id)) return;
    const unsub = onSnapshot(
      doc(db, 'posts', id),
      (snap) => {
        const data = snap.exists()
          ? (snap.data({ serverTimestamps: 'estimate' }) as PostDoc)
          : null;
        this._originals.update((all) => ({ ...all, [id]: data }));
        if (data) {
          this.watchProfile(data.authorUid);
          this.watchProfile(data.guideUid);
        }
      },
      () => {
        this._originals.update((all) => ({ ...all, [id]: null }));
        this.originalUnsubs.delete(id);
      },
    );
    this.originalUnsubs.set(id, unsub);
  }

  /** The raw document for a post id: from the feed, else a watched original. */
  private docOf(id: string | null | undefined): PostDoc | null | undefined {
    if (!id) return undefined;
    return this._postDocs().find((p) => p.id === id)?.data ?? this._originals()[id];
  }

  /** Builds the related context needed by the post or comment workflow. */
  private buildContext() {
    return {
      now: this._now(),
      uid: this.myUid(),
      me: this.me(),
      profiles: this._profiles(),
    };
  }

  /** Turns one Firestore post document into what the screens render. */
  private buildPost(id: string, data: PostDoc, ctx: ReturnType<PostService['buildContext']>): Post {
    const { uid, me, profiles, now } = ctx;
    const mine = !!uid && data.authorUid === uid;
    const profile = profiles[data.authorUid];
    const up = data.likedBy ?? [];
    const down = data.downvotedBy ?? [];
    const reposted = data.repostedBy ?? [];
    const vote: 1 | -1 | 0 = uid && up.includes(uid) ? 1 : uid && down.includes(uid) ? -1 : 0;
    const createdAt = toDate(data.createdAt);
    const rating =
      typeof data.rating === 'number' && data.rating >= 1 && data.rating <= 5
        ? Math.round(data.rating)
        : undefined;

    const guideProfile = data.guideUid ? profiles[data.guideUid] : undefined;
    const guide = data.guideUid
      ? {
          uid: data.guideUid,
          name: data.guideUid === uid ? me.name : (guideProfile?.name || data.guideName || DEFAULT_NAME),
          avatar: data.guideUid === uid ? me.avatar : (guideProfile?.avatar || ''),
        }
      : undefined;

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
      mentions: data.mentions?.length ? data.mentions : undefined,
      images: data.images ?? [],
      trailId: data.trailId || undefined,
      trailName: data.trailName || undefined,
      rating,
      guide,
      upvotes: up.length,
      downvotes: down.length,
      score: up.length - down.length,
      vote,
      likes: up.length,
      liked: vote === 1,
      commentCount: Math.max(0, data.commentCount ?? 0),
      repostCount: reposted.length,
      reposted: !!uid && reposted.includes(uid),
      isRepost: false,
      original: null,
      isMine: mine,
    };
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
      downvotedBy: [],
      repostedBy: [],
      commentCount: 0,
      createdAt: serverTimestamp(),
    };
    if (clean.trailId) {
      payload['trailId'] = clean.trailId;
      payload['trailName'] = clean.trailName ?? '';
      if (clean.rating) payload['rating'] = clean.rating;
    }
    if (clean.guideUid) {
      if (clean.guideUid === uid) throw new CommunityError("You can't tag yourself as your own guide.");
      payload['guideUid'] = clean.guideUid;
      payload['guideName'] = clean.guideName ?? '';
    }
    if (clean.mentions?.length) payload['mentions'] = clean.mentions;
    this.checkSize(payload);

    void this.publishMyProfile();
    try {
      return await withTimeout(addDoc(collection(db, 'posts'), payload));
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t publish your post. Please try again.');
    }
  }

  /** Performs the update post operation for this feature and returns its result to the caller. */
  async updatePost(postId: string, draft: PostDraft): Promise<WriteResult> {
    const uid = this.requireUid();
    const clean = this.validateDraft(draft);

    // The version being replaced, kept in the post's edit history.
    let prev = this.docOf(postId);
    if (!prev) {
      try {
        const snap = await getDoc(doc(db, 'posts', postId));
        prev = snap.exists() ? (snap.data() as PostDoc) : null;
      } catch (e) {
        throw friendlyError(e, 'Couldn\'t save your changes. Please try again.');
      }
    }
    if (!prev) throw new CommunityError('This post has been deleted.', 'not-found');

    const prevImages = prev.images ?? [];
    const sameImages = sameList(prevImages, clean.images);
    const newRating = clean.trailId ? (clean.rating ?? 0) : 0;
    const unchanged =
      (prev.text ?? '') === clean.text &&
      sameImages &&
      (prev.trailId ?? '') === (clean.trailId ?? '') &&
      (prev.rating ?? 0) === newRating &&
      (prev.guideUid ?? '') === (clean.guideUid ?? '') &&
      sameList((prev.mentions ?? []).map((m) => m.uid), (clean.mentions ?? []).map((m) => m.uid));
    // Nothing to save, so don't mark the post "edited" or add a history entry.
    if (unchanged) return 'saved';

    const payload: DocumentData = {
      authorName: this.publicName(),
      text: clean.text,
      images: clean.images,
      trailId: clean.trailId ? clean.trailId : deleteField(),
      trailName: clean.trailId ? (clean.trailName ?? '') : deleteField(),
      rating: clean.trailId && clean.rating ? clean.rating : deleteField(),
      guideUid: clean.guideUid ? clean.guideUid : deleteField(),
      guideName: clean.guideUid ? (clean.guideName ?? '') : deleteField(),
      mentions: clean.mentions?.length ? clean.mentions : deleteField(),
      editedAt: serverTimestamp(),
    };
    if (clean.guideUid === uid) throw new CommunityError("You can't tag yourself as your own guide.");
    this.checkSize({ ...payload, trailId: clean.trailId ?? '', trailName: clean.trailName ?? '' });

    const entry: DocumentData = {
      authorUid: uid,
      text: prev.text ?? '',
      imageCount: prevImages.length,
      savedAt: prev.editedAt ?? prev.createdAt ?? serverTimestamp(),
      replacedAt: serverTimestamp(),
    };
    if (prev.trailId) {
      entry['trailId'] = prev.trailId;
      entry['trailName'] = prev.trailName ?? '';
    }
    if (prev.rating) entry['rating'] = prev.rating;
    if (!sameImages) entry['images'] = prevImages;

    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'posts', postId, 'history')), entry);
    batch.update(doc(db, 'posts', postId), payload);

    try {
      return await withTimeout(batch.commit());
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t save your changes. Please try again.');
    }
  }

  /** Deletes a post, its comments and its edit history. */
  async deletePost(postId: string): Promise<void> {
    this.requireUid();
    try {
      const [comments, history] = await Promise.all([
        getDocs(collection(db, 'posts', postId, 'comments')),
        getDocs(collection(db, 'posts', postId, 'history')),
      ]);
      const refs = [...comments.docs, ...history.docs].map((d) => d.ref);
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

  /**
   * Upvote (dir = 1) or downvote (dir = -1). Tapping the vote you already
   * have takes it back; tapping the other arrow switches your vote.
   */
  async vote(post: Post, dir: 1 | -1): Promise<void> {
    const uid = this.requireUid();
    const next: 1 | -1 | 0 = post.vote === dir ? 0 : dir;
    try {
      await updateDoc(doc(db, 'posts', post.id), {
        likedBy: next === 1 ? arrayUnion(uid) : arrayRemove(uid),
        downvotedBy: next === -1 ? arrayUnion(uid) : arrayRemove(uid),
      });
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t register your vote. Please try again.');
    }
  }

  /** @deprecated Likes are now upvotes. */
  toggleLike(post: Post): Promise<void> {
    return this.vote(post, 1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Reposts
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Reposts `post` to the feed under the signed-in user's name, or takes the
   * repost back if they already did. One repost per person per post: the
   * repost's id is built from both ids, so a double tap can't duplicate it.
   */
  async toggleRepost(post: Post): Promise<'reposted' | 'removed'> {
    const uid = this.requireUid();
    const originalRef = doc(db, 'posts', post.id);
    const repostRef = doc(db, 'posts', `repost_${uid}_${post.id}`);

    try {
      if (post.reposted) {
        await deleteDoc(repostRef);
        await updateDoc(originalRef, { repostedBy: arrayRemove(uid) }).catch(() => {});
        return 'removed';
      }
      const batch = writeBatch(db);
      batch.set(repostRef, {
        authorUid: uid,
        authorName: this.publicName(),
        repostOf: post.id,
        text: '',
        images: [],
        likedBy: [],
        downvotedBy: [],
        repostedBy: [],
        commentCount: 0,
        createdAt: serverTimestamp(),
      });
      batch.update(originalRef, { repostedBy: arrayUnion(uid) });
      void this.publishMyProfile();
      await batch.commit();
      return 'reposted';
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t repost. Please try again.');
    }
  }

  /** Removes one of your reposts (works even if the original was deleted). */
  async removeRepost(repost: Post): Promise<void> {
    const uid = this.requireUid();
    try {
      await deleteDoc(doc(db, 'posts', repost.id));
      if (repost.original) {
        await updateDoc(doc(db, 'posts', repost.original.id), {
          repostedBy: arrayRemove(uid),
        }).catch(() => {});
      }
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t remove the repost. Please try again.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Edit history
  // ═══════════════════════════════════════════════════════════════════════

  /** Starts streaming a post's earlier versions (closing any previous sheet). */
  openHistory(postId: string) {
    this.closeHistory();
    this._historyPostId.set(postId);
    this.historyLoading.set(true);
    this.historyError.set(null);

    const q = query(
      collection(db, 'posts', postId, 'history'),
      orderBy('replacedAt', 'desc'),
      limit(50),
    );
    this.historyUnsub = onSnapshot(
      q,
      (snap) => {
        this._historyDocs.set(
          snap.docs.map((d) => ({
            id: d.id,
            data: d.data({ serverTimestamps: 'estimate' }) as HistoryDoc,
          })),
        );
        this.historyLoading.set(false);
      },
      (err) => {
        console.error('[community] history listener failed', err);
        this.historyLoading.set(false);
        this.historyError.set('Couldn\'t load the edit history.');
      },
    );
  }

  /** Closes or cancels the close history flow and returns the interface to its previous state. */
  closeHistory() {
    this.historyUnsub?.();
    this.historyUnsub = undefined;
    this._historyPostId.set(null);
    this._historyDocs.set([]);
    this.historyError.set(null);
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

  /** Closes or cancels the close thread flow and returns the interface to its previous state. */
  closeThread() {
    this.commentsUnsub?.();
    this.commentsUnsub = undefined;
    this._threadPostId.set(null);
    this._commentDocs.set([]);
    this.commentsError.set(null);
  }

  /** Performs the add comment operation for this feature and returns its result to the caller. */
  async addComment(postId: string, text: string, mentions?: MentionRef[]): Promise<WriteResult> {
    const uid = this.requireUid();
    const body = text.trim();
    if (!body) throw new CommunityError('Write something first.');
    if (body.length > COMMENT_TEXT_MAX) {
      throw new CommunityError(`Comments can be up to ${COMMENT_TEXT_MAX} characters.`);
    }

    const tagged = cleanMentions(body, mentions);
    const commentDoc: DocumentData = {
      authorUid: uid,
      authorName: this.publicName(),
      text: body,
      createdAt: serverTimestamp(),
    };
    if (tagged.length) commentDoc['mentions'] = tagged;

    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'posts', postId, 'comments')), commentDoc);
    batch.update(doc(db, 'posts', postId), { commentCount: increment(1) });

    void this.publishMyProfile();
    try {
      return await withTimeout(batch.commit());
    } catch (e) {
      throw friendlyError(e, 'Couldn\'t post your comment. Please try again.');
    }
  }

  /** Performs the delete comment operation for this feature and returns its result to the caller. */
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

  private profileKey(me: { name: string; avatar: string; bio?: string }) {
    return `${me.name}|${me.avatar.length}|${me.avatar.slice(-48)}|${me.bio ?? ''}`;
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
   * Everyone who signs in gets a public profile (name + small photo only, never
   * email or phone), so other people can find and follow them. It is written
   * once per session and again whenever the name or photo changes.
   */
  private async syncProfile(uid: string, me: { name: string; avatar: string }) {
    if (this.myUid() !== uid) return;
    this.checkedUid = uid;
    if (this.profileKey(me) !== this.publishedKey) await this.publishMyProfile();
  }

  /** Performs the publish my profile operation for this feature and returns its result to the caller. */
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
        bio: me.bio,
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

  /** Ensures an authenticated user id exists before a user-owned operation continues. */
  private requireUid(): string {
    const uid = this.myUid();
    if (!uid) throw new CommunityError('Please sign in first.', 'unauthenticated');
    return uid;
  }

  /** Checks the draft input before it is accepted by the post workflow. */
  private validateDraft(draft: PostDraft): PostDraft {
    const text = (draft.text ?? '').trim();
    const images = (draft.images ?? []).slice(0, POST_PHOTO_MAX);
    if (!text && !images.length) throw new CommunityError('Write something or add a photo.');
    if (text.length > POST_TEXT_MAX) {
      throw new CommunityError(`Posts can be up to ${POST_TEXT_MAX} characters.`);
    }
    const rating =
      draft.trailId && Number.isInteger(draft.rating) && draft.rating! >= 1 && draft.rating! <= 5
        ? draft.rating
        : undefined;
    return {
      text, images, trailId: draft.trailId, trailName: draft.trailName, rating,
      guideUid: draft.guideUid || undefined,
      guideName: draft.guideUid ? (draft.guideName ?? '').slice(0, 60) : undefined,
      mentions: cleanMentions(text, draft.mentions),
    };
  }

  /** Checks the supplied content against the configured size limit. */
  private checkSize(payload: DocumentData) {
    const approx = JSON.stringify(payload).length;
    if (approx > POST_CHARS_MAX) {
      throw new CommunityError('Those photos are too large together. Remove one and try again.');
    }
  }
}
