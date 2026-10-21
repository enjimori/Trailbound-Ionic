/**
 * Community — every post in the feed. Read the comments, remove a comment,
 * or remove a whole post (with its comments and edit history).
 */
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowDownOutline, arrowUpOutline, chatbubbleOutline, chatbubblesOutline, closeOutline,
  locationOutline, repeatOutline, searchOutline, star, trashOutline,
} from 'ionicons/icons';

import { AdminComment, AdminDataService, AdminPost } from '../admin-data.service';
import { AdminUiService } from '../admin-ui.service';
import { initials, matches, timeAgo, tintFor } from '../admin-utils';

type Filter = 'all' | 'photos' | 'rated' | 'reposts';

@Component({
  selector: 'app-admin-community',
  standalone: true,
  imports: [DatePipe, FormsModule, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Community</h1>
        <p>{{ plural(originals(), 'post') }} · {{ plural(totalComments(), 'comment') }} · {{ plural(reposts(), 'repost') }}</p>
      </div>
    </div>

    <div class="tba-toolbar">
      <label class="tba-filter">
        <ion-icon name="search-outline"></ion-icon>
        <input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Text, author or trail" />
      </label>
      <div class="tba-chips">
        @for (f of filters; track f.id) {
          <button type="button" [class.on]="filter() === f.id" (click)="filter.set(f.id)">{{ f.label }}</button>
        }
      </div>
    </div>

    <div class="feed">
      @for (p of shown(); track p.id) {
        <article class="post tba-card">
          <header>
            <span class="tba-avatar sm" [style.background]="tint(p.authorUid)">
              @if (p.avatar) { <img [src]="p.avatar" alt="" /> } @else { {{ ini(p.authorName) }} }
            </span>
            <div class="meta">
              <b>{{ p.authorName }}</b>
              <small>{{ ago(p.createdAt) }}{{ p.edited ? ' · edited' : '' }}</small>
            </div>
            @if (p.repostOf) { <span class="tba-badge" data-tone="sand"><ion-icon name="repeat-outline"></ion-icon>Repost</span> }
          </header>

          @if (p.repostOf) {
            @if (byId()[p.repostOf]; as o) {
              <div class="quoted">
                <b>{{ o.authorName }}</b>
                <p>{{ o.text || '(photo post)' }}</p>
              </div>
            } @else { <p class="text muted">The original post was deleted.</p> }
          } @else {
            @if (p.trailName) {
              <p class="trail">
                <ion-icon name="location-outline"></ion-icon>{{ p.trailName }}
                @if (p.rating) { <span class="stars">@for (s of stars(p.rating); track $index) { <ion-icon name="star"></ion-icon> }</span> }
              </p>
            }
            @if (p.text) { <p class="text">{{ p.text }}</p> }
            @if (p.images.length) {
              <div class="pics" [attr.data-n]="p.images.length">
                @for (img of p.images; track $index) { <img [src]="img" alt="" loading="lazy" /> }
              </div>
            }
          }

          <footer>
            <span title="Upvotes"><ion-icon name="arrow-up-outline"></ion-icon>{{ p.upvotes }}</span>
            <span title="Downvotes"><ion-icon name="arrow-down-outline"></ion-icon>{{ p.downvotes }}</span>
            <button type="button" class="link" (click)="openPost(p)"><ion-icon name="chatbubble-outline"></ion-icon>{{ plural(p.commentCount, 'comment') }}</button>
            <button type="button" class="tba-btn sm danger push" (click)="removePost(p)"><ion-icon name="trash-outline"></ion-icon>Remove</button>
          </footer>
        </article>
      } @empty {
        <div class="tba-card tba-empty">
          <ion-icon name="chatbubbles-outline"></ion-icon>
          <h3>{{ data.posts().length ? 'No posts match' : 'No posts yet' }}</h3>
          <p>{{ data.posts().length ? 'Try another search or filter.' : 'Posts from the Community tab appear here.' }}</p>
        </div>
      }
    </div>

    @if (selected(); as p) {
      <div class="tba-drawer-wrap" (click)="close()">
        <aside class="tba-drawer" (click)="$event.stopPropagation()">
          <header>
            <span class="tba-avatar" [style.background]="tint(p.authorUid)">
              @if (p.avatar) { <img [src]="p.avatar" alt="" /> } @else { {{ ini(p.authorName) }} }
            </span>
            <div>
              <h2>{{ p.authorName }}</h2>
              <p>{{ p.createdAt | date: 'MMM d, y, h:mm a' }}</p>
            </div>
            <button type="button" class="tba-icon-btn" aria-label="Close" (click)="close()"><ion-icon name="close-outline"></ion-icon></button>
          </header>
          <div class="tba-drawer-body">
            @if (p.trailName) { <p class="trail"><ion-icon name="location-outline"></ion-icon>{{ p.trailName }}</p> }
            @if (p.text) { <p class="text full">{{ p.text }}</p> }
            @for (img of p.images; track $index) { <img class="big" [src]="img" alt="" /> }

            <p class="tba-section-title gap">Comments ({{ comments().length }})</p>
            @if (loadingComments()) { <p class="muted small">Loading…</p> }
            @for (c of comments(); track c.id) {
              <div class="comment">
                <span class="tba-avatar sm" [style.background]="tint(c.authorUid)">
                  @if (c.avatar) { <img [src]="c.avatar" alt="" /> } @else { {{ ini(c.authorName) }} }
                </span>
                <div>
                  <b>{{ c.authorName }}</b><small>{{ ago(c.createdAt) }}</small>
                  <p>{{ c.text }}</p>
                </div>
                <button type="button" class="tba-icon-btn del" aria-label="Remove comment" title="Remove comment" (click)="removeComment(p, c)"><ion-icon name="trash-outline"></ion-icon></button>
              </div>
            } @empty {
              @if (!loadingComments()) { <p class="muted small">No comments.</p> }
            }
          </div>
          <footer>
            <button type="button" class="tba-btn danger" (click)="removePost(p)"><ion-icon name="trash-outline"></ion-icon>Remove post</button>
          </footer>
        </aside>
      </div>
    }
  `,
  styles: [`
    .feed { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; align-items: start; }
    .post { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
    .post header { display: flex; align-items: center; gap: 10px; }
    .meta { flex: 1; min-width: 0; }
    .meta b { display: block; font-size: 13.5px; }
    .meta small { font-size: 12px; color: var(--tba-muted); }
    .tba-badge ion-icon { font-size: 12px; }
    .trail { margin: 0; display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--tba-ink-2); }
    .stars { display: inline-flex; margin-left: 4px; color: #e3a73a; }
    .text { margin: 0; font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
    .text.full { display: block; -webkit-line-clamp: unset; margin-bottom: 14px; }
    .muted { color: var(--tba-muted); }
    .small { font-size: 13px; }
    .quoted { border-left: 3px solid var(--tba-sand); padding: 4px 0 4px 12px; }
    .quoted b { font-size: 12.5px; }
    .quoted p { margin: 4px 0 0; font-size: 13px; color: var(--tba-ink-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .pics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
    .pics[data-n='1'] { grid-template-columns: 1fr; }
    .pics img { width: 100%; height: 130px; object-fit: cover; border-radius: 12px; background: var(--tba-soft); }
    .pics[data-n='1'] img { height: 200px; }
    .post footer { display: flex; align-items: center; gap: 14px; padding-top: 12px; border-top: 1px solid var(--tba-line); font-size: 12.5px; color: var(--tba-muted); }
    .post footer span, .link { display: inline-flex; align-items: center; gap: 4px; }
    .link { border: 0; background: none; padding: 0; font-size: 12.5px; font-weight: 600; color: var(--tba-ink-2) !important; }
    .link:hover { text-decoration: underline; }
    .push { margin-left: auto; }
    .big { width: 100%; border-radius: 14px; margin-bottom: 10px; }
    .gap { margin-top: 18px !important; }
    .comment { display: flex; gap: 10px; align-items: flex-start; padding: 12px 0; border-bottom: 1px dashed var(--tba-line); }
    .comment > div { flex: 1; min-width: 0; }
    .comment b { font-size: 13px; margin-right: 6px; }
    .comment small { font-size: 11.5px; color: var(--tba-muted); }
    .comment p { margin: 3px 0 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .del { width: 32px; height: 32px; font-size: 16px; color: var(--tba-down); }
  `],
})
export class AdminCommunityPage {
  readonly data = inject(AdminDataService);
  private readonly ui = inject(AdminUiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'photos', label: 'With photos' },
    { id: 'rated', label: 'Trail ratings' },
    { id: 'reposts', label: 'Reposts' },
  ];
  readonly q = signal('');
  readonly filter = signal<Filter>('all');
  readonly openId = signal<string | null>(null);
  readonly comments = signal<AdminComment[]>([]);
  readonly loadingComments = signal(false);
  private readonly params = toSignal(this.route.queryParamMap);

  readonly byId = computed(() => Object.fromEntries(this.data.posts().map((p) => [p.id, p])));
  readonly originals = computed(() => this.data.posts().filter((p) => !p.repostOf).length);
  readonly reposts = computed(() => this.data.posts().length - this.originals());
  readonly totalComments = computed(() => this.data.posts().reduce((s, p) => s + p.commentCount, 0));

  readonly shown = computed(() => {
    const f = this.filter();
    const q = this.q();
    return this.data.posts().filter(
      (p) =>
        (f === 'all' ||
          (f === 'photos' && p.images.length > 0) ||
          (f === 'rated' && p.rating > 0) ||
          (f === 'reposts' && !!p.repostOf)) &&
        matches(q, p.text, p.authorName, p.trailName),
    );
  });

  readonly selected = computed(() => {
    const id = this.openId();
    return id ? this.byId()[id] ?? null : null;
  });

  constructor() {
    addIcons({
      arrowDownOutline, arrowUpOutline, chatbubbleOutline, chatbubblesOutline, closeOutline,
      locationOutline, repeatOutline, searchOutline, star, trashOutline,
    });
    effect(() => {
      const p = this.params();
      if (!p) return;
      untracked(() => {
        if (p.get('q')) this.q.set(p.get('q')!);
        const id = p.get('open');
        this.openId.set(id);
        if (id) void this.loadComments(id);
      });
    }, { allowSignalWrites: true });
  }

  openPost(p: AdminPost): void {
    this.openId.set(p.id);
    void this.loadComments(p.id);
  }

  close(): void {
    this.openId.set(null);
    this.comments.set([]);
    if (this.route.snapshot.queryParamMap.has('open')) {
      this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  private async loadComments(postId: string): Promise<void> {
    this.loadingComments.set(true);
    this.comments.set([]);
    try {
      const list = await this.data.commentsFor(postId);
      if (this.openId() === postId) this.comments.set(list);
    } catch (e) {
      this.ui.fail(e, 'Could not load the comments.');
    } finally {
      this.loadingComments.set(false);
    }
  }

  async removeComment(p: AdminPost, c: AdminComment): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Remove this comment?',
      message: `“${c.text.slice(0, 120)}” by ${c.authorName} will be deleted for everyone.`,
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.data.deleteComment(p.id, c.id);
      this.comments.update((list) => list.filter((x) => x.id !== c.id));
      this.ui.toast('Comment removed');
    } catch (e) {
      this.ui.fail(e);
    }
  }

  async removePost(p: AdminPost): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Remove this post?',
      message: `${p.authorName}’s post, its ${p.commentCount} comments and its edit history will be deleted for everyone.`,
      confirmText: 'Remove post',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.data.deletePost(p.id);
      if (this.openId() === p.id) this.close();
      this.ui.toast('Post removed');
    } catch (e) {
      this.ui.fail(e);
    }
  }

  plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  stars(n: number): number[] {
    return Array.from({ length: Math.max(0, Math.min(5, n)) });
  }

  ago = timeAgo;
  ini = initials;
  tint = tintFor;
}
