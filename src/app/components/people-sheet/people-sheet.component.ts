import { Component, EventEmitter, Input, Output, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonIcon, IonLabel, IonModal, IonSegment, IonSegmentButton,
  IonSpinner, IonToolbar, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chevronBack, closeCircle, person, peopleOutline, searchOutline } from 'ionicons/icons';
import { FollowService, PersonSummary } from '../../services/follow.service';
import { PostService } from '../../services/post.service';
import { fuzzyFilter } from '../../services/fuzzy.util';

type ListTab = 'following' | 'followers';

/**
 * Bottom sheet with two screens:
 *   1. Search  — fuzzy-search every public profile; "Following" / "Followers" lists when idle.
 *   2. Profile — photo, name, counts, a Follow button, and their recent posts.
 *
 * Open it on the search screen (uid = null) or straight on someone's profile
 * (uid = theirs, e.g. when a name on a post is tapped). No messaging.
 */
@Component({
  selector: 'app-people-sheet',
  standalone: true,
  templateUrl: './people-sheet.component.html',
  styleUrls: ['./people-sheet.component.scss'],
  imports: [
    CommonModule, IonModal, IonHeader, IonToolbar, IonContent, IonIcon, IonSpinner,
    IonSegment, IonSegmentButton, IonLabel,
  ],
})
export class PeopleSheetComponent {
  private readonly router = inject(Router);
  private readonly toastCtrl = inject(ToastController);
  readonly follows = inject(FollowService);
  private readonly postService = inject(PostService);

  @Input() open = false;
  /** Open straight on this person's profile; null opens the search screen. */
  @Input() set uid(v: string | null) {
    this.selectedUid.set(v);
    this.openedOnProfile = !!v;
  }
  /** Pick mode: tapping a person hands them back through `picked` (e.g. to tag a guide). */
  @Input() pick = false;
  @Output() picked = new EventEmitter<PersonSummary>();
  @Output() closed = new EventEmitter<void>();

  openedOnProfile = false;

  readonly selectedUid = signal<string | null>(null);
  readonly query = signal('');
  readonly tab = signal<ListTab>('following');
  readonly directory = signal<PersonSummary[]>([]);
  readonly loading = signal(false);
  readonly loadFailed = signal(false);
  readonly counts = signal<{ followers: number; following: number } | null>(null);

  private readonly byUid = computed(() => new Map(this.directory().map((p) => [p.uid, p])));

  /** Everyone except you, matched loosely against what was typed. */
  readonly results = computed(() => {
    const me = this.follows.myUid();
    const q = this.query().trim();
    if (!q) return [];
    return fuzzyFilter(this.directory().filter((p) => p.uid !== me), q, (p) => p.name);
  });

  /** The "Following" / "Followers" list shown before anything is typed. */
  readonly connections = computed<PersonSummary[]>(() => {
    const uids = this.tab() === 'following' || this.pick ? this.follows.followingUids() : this.follows.followerUids();
    const map = this.byUid();
    return [...uids]
      .map((id) => map.get(id))
      .filter((p): p is PersonSummary => !!p)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** Whoever's profile is on screen. */
  readonly person = computed<PersonSummary | null>(() => {
    const uid = this.selectedUid();
    if (!uid) return null;
    const found = this.byUid().get(uid);
    if (found) return found;
    // Directory still loading: borrow the name and photo from a post they wrote.
    const post = this.postService.posts().find((p) => p.authorUid === uid);
    return post ? { uid, name: post.author, avatar: post.avatar } : null;
  });

  readonly personPosts = computed(() => {
    const uid = this.selectedUid();
    if (!uid) return [];
    return this.postService.posts().filter((p) => p.authorUid === uid && !p.isRepost).slice(0, 5);
  });

  readonly isMe = computed(() => !!this.selectedUid() && this.selectedUid() === this.follows.myUid());
  readonly signedIn = computed(() => !!this.follows.myUid());

  constructor() {
    addIcons({ chevronBack, closeCircle, person, peopleOutline, searchOutline });

    // Fetch the counts whenever a profile is shown.
    effect(() => {
      const uid = this.selectedUid();
      untracked(() => {
        this.counts.set(null);
        if (uid) this.follows.countsFor(uid).then((c) => {
          if (this.selectedUid() === uid) this.counts.set(c);
        });
      });
    });
  }

  async onPresented() {
    this.query.set('');
    this.tab.set('following');
    this.loading.set(true);
    this.loadFailed.set(false);
    try {
      this.directory.set(await this.follows.loadDirectory());
    } catch {
      this.loadFailed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  onDismissed() {
    this.selectedUid.set(null);
    this.query.set('');
    this.closed.emit();
  }

  onSearchInput(ev: Event) {
    this.query.set((ev.target as HTMLInputElement).value);
  }

  clearSearch(input: HTMLInputElement) {
    this.query.set('');
    input.value = '';
    input.focus();
  }

  onTab(ev: CustomEvent) {
    this.tab.set(ev.detail.value as ListTab);
  }

  openPerson(p: PersonSummary) {
    if (this.pick) {
      this.picked.emit(p);
      this.closed.emit();
      return;
    }
    this.selectedUid.set(p.uid);
  }

  back() {
    this.selectedUid.set(null);
  }

  async toggleFollow(p: PersonSummary, ev?: Event) {
    ev?.stopPropagation();
    if (!this.signedIn()) {
      this.closed.emit();
      this.router.navigate(['/login'], { queryParams: { returnUrl: '/tabs/community' } });
      return;
    }
    try {
      const result = await this.follows.toggle(p.uid);
      // Keep the profile's follower count in step with the button.
      if (this.selectedUid() === p.uid && this.counts()) {
        const c = this.counts()!;
        this.counts.set({ ...c, followers: Math.max(0, c.followers + (result === 'followed' ? 1 : -1)) });
      }
      this.toast(result === 'followed' ? `You're following ${p.name}` : `Unfollowed ${p.name}`);
    } catch (e) {
      this.toast((e as Error).message, true);
    }
  }

  trackByUid = (_: number, p: PersonSummary) => p.uid;
  trackById = (_: number, item: { id: string }) => item.id;

  private async toast(message: string, error = false) {
    const t = await this.toastCtrl.create({
      message, duration: 1800, position: 'bottom', color: error ? 'danger' : undefined,
    });
    await t.present();
  }
}
