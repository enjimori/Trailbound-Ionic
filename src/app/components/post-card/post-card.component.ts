import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonBadge } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, arrowDownCircle, arrowDownCircleOutline, arrowUpCircle,
  arrowUpCircleOutline, repeat, repeatOutline, star, starOutline,
} from 'ionicons/icons';
import { Post } from '../../models/post.model';
import { MentionTextComponent } from '../mention-text/mention-text.component';

/** Long posts are clipped to this many characters until "See more" is tapped. */
const PREVIEW_CHARS = 280;

@Component({
  selector: 'app-post-card',
  standalone: true,
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.scss'],
  imports: [CommonModule, IonIcon, IonBadge, MentionTextComponent],
})
export class PostCardComponent {
  @Input({ required: true }) post!: Post;
  /** Briefly outlines the card (used when opening a shared link). */
  @Input() highlight = false;

  /** Upvote (dir 1) or downvote (dir -1) the post being shown. */
  @Output() vote = new EventEmitter<{ post: Post; dir: 1 | -1 }>();
  @Output() repost = new EventEmitter<Post>();
  @Output() comment = new EventEmitter<Post>();
  @Output() share = new EventEmitter<Post>();
  /** The "..." button: edit / delete for your posts, share / copy for others. */
  @Output() menu = new EventEmitter<Post>();
  @Output() openImage = new EventEmitter<{ post: Post; index: number }>();
  @Output() openTrail = new EventEmitter<Post>();
  /** The "edited" label: show the post's earlier versions. */
  @Output() history = new EventEmitter<Post>();
  /** A name or photo was tapped: open that person's profile (their uid). */
  @Output() openUser = new EventEmitter<string>();

  expanded = false;
  readonly stars = [1, 2, 3, 4, 5];

  constructor() {
    addIcons({
      alertCircleOutline, arrowDownCircle, arrowDownCircleOutline, arrowUpCircle,
      arrowUpCircleOutline, repeat, repeatOutline, star, starOutline,
    });
  }

  /**
   * The post whose content, votes and comments this card shows. For a repost
   * that is the original; the repost itself only adds the "reposted" banner.
   * Every action (vote, comment, repost, share) applies to this post.
   */
  get target(): Post {
    return this.post.original ?? this.post;
  }

  /** Checks whether the post text exceeds the collapsed preview length. */
  get isLong(): boolean {
    return this.target.content.length > PREVIEW_CHARS;
  }

  /** Opens the shown text interface for the user. */
  get shownText(): string {
    const text = this.target.content;
    if (this.expanded || !this.isLong) return text;
    return text.slice(0, PREVIEW_CHARS).trimEnd() + '…';
  }

  /** Performs the format count operation for this feature and returns its result to the caller. */
  formatCount(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
    return n.toString();
  }
}
