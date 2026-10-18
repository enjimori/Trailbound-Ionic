/**
 * What the community screens render. Built by PostService from the Firestore
 * documents plus the author's public profile, so the name and photo always
 * belong to the account that actually wrote the post or comment.
 */

import type { MentionRef } from '../services/mention.util';

export interface PostComment {
  id: string;
  /** Firebase uid of the account that wrote the comment. */
  authorUid: string;
  author: string;
  /** Data URL of the author's profile photo, or '' for the default avatar. */
  avatar: string;
  text: string;
  /** People tagged with @ in the text. */
  mentions?: MentionRef[];
  timeAgo: string;
  createdAt: Date | null;
  /** Written by the signed-in user (can delete it). */
  isMine: boolean;
  /** Written by the person who made the post — shown with an "Author" tag. */
  isPostAuthor: boolean;
}

export interface Post {
  id: string;
  /** Firebase uid of the account that made the post. */
  authorUid: string;
  author: string;
  /** Data URL of the author's profile photo, or '' for the default avatar. */
  avatar: string;
  handle?: string;
  timeAgo: string;
  createdAt: Date | null;
  edited: boolean;
  isPro?: boolean;
  content: string;
  /** People tagged with @ in the text. */
  mentions?: MentionRef[];
  tags?: string[];
  /** Uploaded photos (compressed JPEG data URLs). */
  images: string[];
  /** Trail the post is about, if the author tagged one. */
  trailId?: string;
  trailName?: string;
  /** 1–5 star rating of the tagged trail, if the author gave one. */
  rating?: number;
  /** The guide the author tagged ("Guided by …"), if any. Name and photo are live. */
  guide?: { uid: string; name: string; avatar: string };
  upvotes: number;
  downvotes: number;
  /** upvotes − downvotes. */
  score: number;
  /** The signed-in user's vote: 1 = upvoted, -1 = downvoted, 0 = none. */
  vote: 1 | -1 | 0;
  /** @deprecated Kept so older screens still compile. Same as `upvotes`. */
  likes: number;
  /** @deprecated Same as `vote === 1`. */
  liked: boolean;
  commentCount: number;
  /** How many people have reposted this post. */
  repostCount: number;
  /** The signed-in user has reposted this post. */
  reposted: boolean;
  /** This entry is somebody's repost; `author` / `avatar` are the reposter's. */
  isRepost: boolean;
  /** For a repost: the original post, or null if it was deleted. Otherwise null. */
  original: Post | null;
  /** Made by the signed-in user (can edit / delete it). */
  isMine: boolean;
}

/** What the composer hands to PostService for a new or edited post. */
export interface PostDraft {
  text: string;
  images: string[];
  trailId?: string;
  trailName?: string;
  /** 1–5 stars for the tagged trail. Ignored when no trail is tagged. */
  rating?: number;
  /** The guide being tagged. Name is a fallback for when their profile can't be read. */
  guideUid?: string;
  guideName?: string;
  /** People tagged with @ in the text. */
  mentions?: MentionRef[];
}

/** One saved version of a post, for the "Edit history" sheet. */
export interface PostVersion {
  id: string;
  /** The version being shown right now. */
  isCurrent: boolean;
  /** The very first version, as first posted. */
  isOriginal: boolean;
  text: string;
  images: string[];
  trailName?: string;
  /** 1–5 stars for the tagged trail. */
  rating?: number;
  /** When this version was saved, e.g. "Oct 18, 2026, 3:42 PM". */
  whenLabel: string;
}
