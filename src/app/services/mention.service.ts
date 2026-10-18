import { Injectable, inject } from '@angular/core';
import { FollowService, PersonSummary } from './follow.service';

/**
 * Who can be @mentioned. Only people already connected to the user:
 *   • people you follow,
 *   • the author of the post being commented on,
 *   • people who have commented on it.
 * Strangers never appear, because the list is built only from those three sources.
 */
@Injectable({ providedIn: 'root' })
export class MentionService {
  private readonly follows = inject(FollowService);

  /**
   * @param extra people tied to this post (its author and commenters), as uid + name.
   * Returns matches for `query`, best first, without yourself.
   */
  async suggest(
    query: string,
    extra: { uid: string; name: string; avatar?: string }[] = [],
  ): Promise<PersonSummary[]> {
    const me = this.follows.myUid();
    const directory = await this.follows.loadDirectory();
    const following = this.follows.followingUids();

    const pool = new Map<string, PersonSummary>();
    // People you follow (names come from the cached public profiles).
    for (const p of directory) {
      if (following.has(p.uid)) pool.set(p.uid, p);
    }
    // The post's author and commenters (they may not be followed).
    for (const e of extra) {
      if (!pool.has(e.uid)) pool.set(e.uid, { uid: e.uid, name: e.name, avatar: e.avatar ?? '' });
    }
    if (me) pool.delete(me);

    const q = query.trim().toLowerCase();
    const list = [...pool.values()].filter((p) => !q || p.name.toLowerCase().includes(q));
    // Names that start with the query come first, then alphabetical.
    return list
      .sort((a, b) => {
        const sa = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const sb = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return sa - sb || a.name.localeCompare(b.name);
      })
      .slice(0, 6);
  }
}
