import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonBadge } from '@ionic/angular/standalone';
import { Post } from '../../models/post.model';

/** Long posts are clipped to this many characters until "See more" is tapped. */
const PREVIEW_CHARS = 280;

@Component({
  selector: 'app-post-card',
  standalone: true,
  templateUrl: './post-card.component.html',
  styleUrls: ['./post-card.component.scss'],
  imports: [CommonModule, IonIcon, IonBadge],
})
export class PostCardComponent {
  @Input({ required: true }) post!: Post;
  /** Briefly outlines the card (used when opening a shared link). */
  @Input() highlight = false;

  @Output() like = new EventEmitter<Post>();
  @Output() comment = new EventEmitter<Post>();
  @Output() share = new EventEmitter<Post>();
  /** The "..." button: edit / delete for your posts, share / copy for others. */
  @Output() menu = new EventEmitter<Post>();
  @Output() openImage = new EventEmitter<{ post: Post; index: number }>();
  @Output() openTrail = new EventEmitter<Post>();

  expanded = false;

  get isLong(): boolean {
    return this.post.content.length > PREVIEW_CHARS;
  }

  get shownText(): string {
    if (this.expanded || !this.isLong) return this.post.content;
    return this.post.content.slice(0, PREVIEW_CHARS).trimEnd() + '…';
  }

  formatLikes(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
    return n.toString();
  }
}
