import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { addIcons } from 'ionicons';
import { peopleOutline } from 'ionicons/icons';
import { AppNotification } from '../models/notification.model';
import { FollowService } from './follow.service';
import { PostService } from './post.service';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FOLLOW ALERTS — "someone you follow posted"
 *
 * Built from the live community feed, so there is nothing extra to store in
 * Firestore. A post only becomes an alert when ALL of these are true:
 *   • you follow its author,
 *   • it was posted AFTER you followed them (following someone never floods
 *     you with their old posts),
 *   • it isn't yours and isn't a repost,
 *   • it is less than a week old.
 * Which alerts you've read is remembered on this device, per account.
 *
 * NotificationService merges these into the main notification list.
 *
 * Limits: alerts only appear while the app is open (there is no push), and
 * they cover the newest posts the feed has loaded.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ALERTS = 20;
const MAX_REMEMBERED = 300;
const SNIPPET_CHARS = 90;

@Injectable({ providedIn: 'root' })
export class FollowAlertsService {
  private readonly follows = inject(FollowService);
  private readonly postService = inject(PostService);

  private readonly _read = signal<Set<string>>(new Set());

  readonly alerts = computed<AppNotification[]>(() => {
    if (!this.follows.myUid()) return [];
    const following = this.follows.followingUids();
    if (!following.size) return [];
    const since = this.follows.followedAt();
    const read = this._read();
    const cutoff = Date.now() - MAX_AGE_MS;

    return this.postService
      .posts()
      .filter((p) => {
        if (p.isRepost || p.isMine || !p.createdAt || !following.has(p.authorUid)) return false;
        return p.createdAt.getTime() >= Math.max(cutoff, since.get(p.authorUid) ?? 0);
      })
      .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
      .slice(0, MAX_ALERTS)
      .map((p) => {
        const text = p.content.trim();
        const snippet = text.length > SNIPPET_CHARS ? text.slice(0, SNIPPET_CHARS).trimEnd() + '…' : text;
        const id = `post-${p.id}`;
        return {
          id,
          type: 'social' as const,
          postId: p.id,
          createdAt: p.createdAt!.getTime(),
          title: `${p.author} shared a post`,
          message: snippet || (p.trailName ? `Posted about ${p.trailName}` : 'Shared photos'),
          time: p.timeAgo,
          read: read.has(id),
          icon: 'people-outline',
          iconColor: '#E8D99C',
        };
      });
  });

  constructor() {
    addIcons({ peopleOutline });
    // Load this account's read list whenever someone signs in or out.
    effect(() => {
      const uid = this.follows.myUid();
      untracked(() => this._read.set(uid ? this.load(uid) : new Set()));
    });
  }

  /** Performs the mark read operation for this feature and returns its result to the caller. */
  markRead(id: string) {
    this.add([id]);
  }

  /** Marks every currently available notification as read. */
  markAllRead() {
    this.add(this.alerts().map((a) => a.id));
  }

  // ── remembered on this device ───────────────────────────────────────────

  private key(uid: string) {
    return `trailbound.followAlerts.read.${uid}`;
  }

  /** Reads previously saved state and returns the initial data used by the service. */
  private load(uid: string): Set<string> {
    try {
      const raw = localStorage.getItem(this.key(uid));
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }

  /** Records newly followed accounts so the user can be alerted to their posts. */
  private add(ids: string[]) {
    const uid = this.follows.myUid();
    if (!uid || !ids.length) return;
    const next = new Set(this._read());
    ids.forEach((id) => next.add(id));
    const kept = [...next].slice(-MAX_REMEMBERED);
    this._read.set(new Set(kept));
    try {
      localStorage.setItem(this.key(uid), JSON.stringify(kept));
    } catch {
      /* storage full or blocked: still works for this session */
    }
  }
}
