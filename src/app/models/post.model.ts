/**
 * What the community screens render. Built by PostService from the Firestore
 * documents plus the author's public profile, so the name and photo always
 * belong to the account that actually wrote the post or comment.
 */

export interface PostComment {
  id: string;
  /** Firebase uid of the account that wrote the comment. */
  authorUid: string;
  author: string;
  /** Data URL of the author's profile photo, or '' for the default avatar. */
  avatar: string;
  text: string;
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
  tags?: string[];
  /** Uploaded photos (compressed JPEG data URLs). */
  images: string[];
  /** Trail the post is about, if the author tagged one. */
  trailId?: string;
  trailName?: string;
  likes: number;
  /** The signed-in user has liked this post. */
  liked: boolean;
  commentCount: number;
  /** Made by the signed-in user (can edit / delete it). */
  isMine: boolean;
}

/** What the composer hands to PostService for a new or edited post. */
export interface PostDraft {
  text: string;
  images: string[];
  trailId?: string;
  trailName?: string;
}
