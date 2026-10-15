import { Component, ElementRef, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent, IonHeader, IonFooter, IonToolbar, IonIcon, IonBadge, IonModal,
  IonTextarea, IonSpinner,
  ActionSheetController, AlertController, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  imagesOutline, closeCircle, refreshOutline, copyOutline, chevronDownOutline, createOutline,
  cloudOfflineOutline,
} from 'ionicons/icons';
import { PostCardComponent } from '../../components/post-card/post-card.component';
import {
  PostService, CommunityError, POST_TEXT_MAX, COMMENT_TEXT_MAX, POST_PHOTO_MAX,
} from '../../services/post.service';
import { NotificationService } from '../../services/notification.service';
import { UserService } from '../../services/user.service';
import { Post, PostComment } from '../../models/post.model';
import { AppLogoComponent } from '../../components/app-logo/app-logo.component';
import { compressPhoto, looksLikeImage } from '../../services/photo.util';
// The same 30 trails as Explore, so a tagged post links to a real trail page.
import { TRAILS_30 } from '../explore/explore-trails.data';

type FeedFilter = 'latest' | 'top' | 'mine';

@Component({
  selector: 'app-community',
  standalone: true,
  templateUrl: './community.page.html',
  styleUrls: ['./community.page.scss'],
  imports: [
    CommonModule, FormsModule, IonContent, IonHeader, IonFooter, IonToolbar, IonIcon, IonBadge,
    IonModal, IonTextarea, IonSpinner, PostCardComponent, AppLogoComponent,
  ],
})
export class CommunityPage {
  readonly postService = inject(PostService);
  readonly notificationService = inject(NotificationService);
  readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);

  @ViewChild(IonContent) private content?: IonContent;
  @ViewChild('composerModal') private composerModal?: IonModal;
  @ViewChild('photoInput') private photoInput?: ElementRef<HTMLInputElement>;

  readonly POST_TEXT_MAX = POST_TEXT_MAX;
  readonly COMMENT_TEXT_MAX = COMMENT_TEXT_MAX;
  readonly POST_PHOTO_MAX = POST_PHOTO_MAX;

  // ── feed ────────────────────────────────────────────────────────────────
  readonly filter = signal<FeedFilter>('latest');

  /** "My posts" falls back to Latest once nobody is signed in. */
  readonly activeFilter = computed<FeedFilter>(() =>
    this.filter() === 'mine' && !this.userService.isAuthenticated() ? 'latest' : this.filter(),
  );

  readonly visiblePosts = computed<Post[]>(() => {
    const posts = this.postService.posts();
    switch (this.activeFilter()) {
      case 'mine':
        return posts.filter((p) => p.isMine);
      case 'top':
        return [...posts].sort(
          (a, b) => b.likes + b.commentCount - (a.likes + a.commentCount),
        );
      default:
        return posts;
    }
  });

  /** Post opened from a shared link (?post=id), outlined for a moment. */
  readonly highlightId = signal<string | null>(null);
  private readonly focusId = signal<string | null>(null);

  // ── composer ────────────────────────────────────────────────────────────
  showComposer = false;
  editingPostId: string | null = null;
  draftText = '';
  draftImages: string[] = [];
  draftTrail: { id: string; name: string } | null = null;
  processingPhotos = false;
  publishing = false;
  showTrailPicker = false;
  trailQuery = '';
  /** Set right before a programmatic close, so "Discard post?" is skipped. */
  private skipDiscardCheck = false;
  /** Photos picked before the composer was open (camera shortcut). */
  private pendingFiles: File[] = [];

  // ── comments ────────────────────────────────────────────────────────────
  showComments = false;
  newComment = '';
  sendingComment = false;

  readonly activePost = computed(() => {
    const id = this.postService.threadPostId();
    return id ? this.postService.posts().find((p) => p.id === id) ?? null : null;
  });

  // ── photo viewer ────────────────────────────────────────────────────────
  viewer: { images: string[]; index: number } | null = null;

  constructor() {
    addIcons({
      imagesOutline, closeCircle, refreshOutline, copyOutline, chevronDownOutline, createOutline,
      cloudOfflineOutline,
    });

    this.route.queryParamMap.subscribe((params) => {
      const id = params.get('post');
      if (id) this.focusId.set(id);
    });

    // Once the feed has loaded, scroll to a post opened from a shared link.
    effect(() => {
      const id = this.focusId();
      const loading = this.postService.loading();
      const found = this.postService.posts().some((p) => p.id === id);
      if (!id || loading) return;
      untracked(() => this.focusPost(id, found));
    });
  }

  get isSignedIn(): boolean {
    return this.userService.isAuthenticated();
  }

  get me() {
    return this.postService.me();
  }

  goNotifications() {
    this.router.navigate(['/notifications']);
  }

  goSignIn() {
    this.router.navigate(['/login'], { queryParams: { returnUrl: '/tabs/community' } });
  }

  trackById = (_: number, item: { id: string }) => item.id;

  setFilter(f: FeedFilter) {
    if (f === 'mine' && !this.isSignedIn) {
      this.askToSignIn('see your posts');
      return;
    }
    this.filter.set(f);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Likes / share / menu
  // ═══════════════════════════════════════════════════════════════════════

  async onLike(post: Post) {
    if (!this.isSignedIn) {
      this.askToSignIn('like posts');
      return;
    }
    try {
      await this.postService.toggleLike(post);
    } catch (e) {
      this.toast(this.message(e), 'danger');
    }
  }

  async onShare(post: Post) {
    const url = this.postLink(post);
    const where = post.trailName ? ` (${post.trailName})` : '';
    const text = `${post.author} on TrailBound${where}${post.content ? ': ' + post.content : ''}`;

    if ((navigator as any).share) {
      try {
        await (navigator as any).share({ title: 'TrailBound', text, ...(url ? { url } : {}) });
      } catch {
        // user cancelled the share sheet
      }
      return;
    }
    const copied = await this.copy(url ? `${text}\n${url}` : text);
    this.toast(copied ? (url ? 'Link copied to clipboard' : 'Post copied to clipboard') : 'Couldn\'t copy on this device.');
  }

  async onMenu(post: Post) {
    const buttons: any[] = [];
    if (post.isMine) {
      buttons.push(
        { text: 'Edit post', icon: 'create-outline', handler: () => { this.openEditor(post); } },
        { text: 'Delete post', icon: 'trash-outline', role: 'destructive', handler: () => { this.confirmDeletePost(post); } },
      );
    }
    buttons.push({ text: 'Share post', icon: 'share-social-outline', handler: () => { this.onShare(post); } });
    if (post.content) {
      buttons.push({
        text: 'Copy text',
        icon: 'copy-outline',
        handler: () => {
          this.copy(post.content).then((ok) => this.toast(ok ? 'Text copied' : 'Couldn\'t copy on this device.'));
        },
      });
    }
    if (post.trailId) {
      buttons.push({ text: `View ${post.trailName || 'trail'}`, icon: 'location-outline', handler: () => { this.openTrail(post); } });
    }
    buttons.push({ text: 'Cancel', role: 'cancel' });

    const sheet = await this.actionSheetCtrl.create({ header: post.isMine ? 'Your post' : post.author, buttons });
    await sheet.present();
  }

  openTrail(post: Post) {
    if (post.trailId) this.router.navigate(['/trail', post.trailId]);
  }

  private async confirmDeletePost(post: Post) {
    const n = post.commentCount;
    const alert = await this.alertCtrl.create({
      header: 'Delete post?',
      message: n
        ? `This also removes its ${n} comment${n === 1 ? '' : 's'}. This can't be undone.`
        : 'This can\'t be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.postService.deletePost(post.id)
              .then(() => this.toast('Post deleted'))
              .catch((e) => this.toast(this.message(e), 'danger'));
          },
        },
      ],
    });
    await alert.present();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Composer (new post / edit post)
  // ═══════════════════════════════════════════════════════════════════════

  openComposer() {
    if (!this.isSignedIn) {
      this.askToSignIn('share your hikes');
      return;
    }
    this.resetDraft();
    this.showComposer = true;
  }

  /** Camera shortcut on the "Create Post" card: pick photos first, then write. */
  pickPhotosFromCard(ev: Event) {
    ev.stopPropagation();
    if (!this.isSignedIn) {
      this.askToSignIn('share your hikes');
      return;
    }
    this.photoInput?.nativeElement.click();
  }

  openEditor(post: Post) {
    this.resetDraft();
    this.editingPostId = post.id;
    this.draftText = post.content;
    this.draftImages = [...post.images];
    this.draftTrail = post.trailId ? { id: post.trailId, name: post.trailName || 'Trail' } : null;
    this.showComposer = true;
  }

  get canPublish(): boolean {
    return !this.publishing && !this.processingPhotos
      && (this.draftText.trim().length > 0 || this.draftImages.length > 0)
      && this.draftText.length <= POST_TEXT_MAX;
  }

  private get isDirty(): boolean {
    return !!(this.draftText.trim() || this.draftImages.length || this.draftTrail);
  }

  /** Runs before the composer closes (Cancel button or swipe down). */
  readonly canDismissComposer = async (): Promise<boolean> => {
    if (this.publishing) return false;
    if (this.skipDiscardCheck || !this.isDirty) return true;
    const alert = await this.alertCtrl.create({
      header: this.editingPostId ? 'Discard changes?' : 'Discard post?',
      message: 'What you wrote will be lost.',
      buttons: [
        { text: 'Keep editing', role: 'cancel' },
        { text: 'Discard', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'destructive';
  };

  closeComposer() {
    this.composerModal?.dismiss();
  }

  onComposerDidPresent() {
    if (this.pendingFiles.length) {
      const files = this.pendingFiles;
      this.pendingFiles = [];
      this.addPhotos(files);
    }
  }

  onComposerDismissed() {
    this.showComposer = false;
    this.resetDraft();
  }

  private resetDraft() {
    this.skipDiscardCheck = false;
    this.editingPostId = null;
    this.draftText = '';
    this.draftImages = [];
    this.draftTrail = null;
    this.showTrailPicker = false;
    this.trailQuery = '';
  }

  choosePhotos() {
    if (this.draftImages.length >= POST_PHOTO_MAX) {
      this.toast(`You can add up to ${POST_PHOTO_MAX} photos.`);
      return;
    }
    this.photoInput?.nativeElement.click();
  }

  onPhotosPicked(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // so picking the same photo again still fires
    if (!files.length) return;

    if (!this.showComposer) {
      // Came from the camera shortcut: open the composer, then add them.
      this.resetDraft();
      this.pendingFiles = files;
      this.showComposer = true;
      return;
    }
    this.addPhotos(files);
  }

  private async addPhotos(files: File[]) {
    const room = POST_PHOTO_MAX - this.draftImages.length;
    if (room <= 0) {
      this.toast(`You can add up to ${POST_PHOTO_MAX} photos.`);
      return;
    }
    if (files.length > room) {
      this.toast(
        `Posts can have up to ${POST_PHOTO_MAX} photos, so only the first ${room === 1 ? 'one was' : room + ' were'} added.`,
      );
    }

    this.processingPhotos = true;
    let failed = 0;
    try {
      for (const file of files.slice(0, room)) {
        if (!looksLikeImage(file)) {
          failed++;
          continue;
        }
        try {
          this.draftImages = [...this.draftImages, await compressPhoto(file)];
        } catch {
          failed++;
        }
      }
    } finally {
      this.processingPhotos = false;
    }
    if (failed) {
      this.toast(
        failed === 1
          ? 'One file couldn\'t be read as a photo. Try a JPG or PNG.'
          : `${failed} files couldn't be read as photos. Try JPG or PNG.`,
        'danger',
      );
    }
  }

  removePhoto(index: number) {
    this.draftImages = this.draftImages.filter((_, i) => i !== index);
  }

  // ── trail tag ───────────────────────────────────────────────────────────

  get trailMatches() {
    const q = this.trailQuery.trim().toLowerCase();
    const list = q
      ? TRAILS_30.filter((t) => t.name.toLowerCase().includes(q) || t.region.toLowerCase().includes(q))
      : TRAILS_30;
    return list.slice(0, 8);
  }

  toggleTrailPicker() {
    this.showTrailPicker = !this.showTrailPicker;
    this.trailQuery = '';
  }

  selectTrail(t: { id: string; name: string }) {
    this.draftTrail = { id: t.id, name: t.name };
    this.showTrailPicker = false;
    this.trailQuery = '';
  }

  clearTrail() {
    this.draftTrail = null;
  }

  // ── publish ─────────────────────────────────────────────────────────────

  async publishPost() {
    if (!this.canPublish) return;
    const editing = this.editingPostId;
    this.publishing = true;
    try {
      const draft = {
        text: this.draftText,
        images: this.draftImages,
        trailId: this.draftTrail?.id,
        trailName: this.draftTrail?.name,
      };
      const result = editing
        ? await this.postService.updatePost(editing, draft)
        : await this.postService.createPost(draft);

      this.publishing = false;
      this.skipDiscardCheck = true;
      await this.composerModal?.dismiss();

      if (result === 'pending') {
        this.toast('Slow connection — your post will finish sending in the background.');
      } else {
        this.toast(editing ? 'Post updated' : 'Your post is live!', 'success');
      }
      if (!editing) {
        this.filter.set('latest');
        this.content?.scrollToTop(300);
      }
    } catch (e) {
      this.toast(this.message(e), 'danger');
    } finally {
      this.publishing = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Comments
  // ═══════════════════════════════════════════════════════════════════════

  openComments(post: Post) {
    this.postService.openThread(post.id);
    this.newComment = '';
    this.showComments = true;
  }

  onCommentsDismissed() {
    this.showComments = false;
    this.newComment = '';
    this.postService.closeThread();
  }

  canDeleteComment(c: PostComment): boolean {
    // Your own comments, or any comment on your own post.
    return c.isMine || !!this.activePost()?.isMine;
  }

  async submitComment(list?: IonContent) {
    const post = this.activePost();
    const text = this.newComment.trim();
    if (!post || !text || this.sendingComment) return;
    if (!this.isSignedIn) {
      this.askToSignIn('comment');
      return;
    }
    this.sendingComment = true;
    try {
      const result = await this.postService.addComment(post.id, text);
      this.newComment = '';
      if (result === 'pending') this.toast('Slow connection — your comment will send in the background.');
      setTimeout(() => list?.scrollToBottom(250), 60);
    } catch (e) {
      this.toast(this.message(e), 'danger');
    } finally {
      this.sendingComment = false;
    }
  }

  async confirmDeleteComment(c: PostComment) {
    const post = this.activePost();
    if (!post) return;
    const alert = await this.alertCtrl.create({
      header: 'Delete comment?',
      message: c.isMine ? 'Your comment will be removed.' : `Remove ${c.author}'s comment from your post?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            this.postService.deleteComment(post.id, c.id)
              .catch((e) => this.toast(this.message(e), 'danger'));
          },
        },
      ],
    });
    await alert.present();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Photo viewer
  // ═══════════════════════════════════════════════════════════════════════

  openViewer(ev: { post: Post; index: number }) {
    this.viewer = { images: ev.post.images, index: ev.index };
  }

  openDraftViewer(index: number) {
    this.viewer = { images: this.draftImages, index };
  }

  onViewerPresented() {
    const strip = document.querySelector<HTMLElement>('ion-modal.viewer-modal .viewer-strip');
    if (strip && this.viewer) strip.scrollLeft = this.viewer.index * strip.clientWidth;
  }

  onViewerScroll(strip: HTMLElement) {
    if (!this.viewer || !strip.clientWidth) return;
    this.viewer.index = Math.round(strip.scrollLeft / strip.clientWidth);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════════════════

  private async askToSignIn(action: string) {
    const alert = await this.alertCtrl.create({
      header: 'Sign in required',
      message: `Sign in or create a free account to ${action}.`,
      buttons: [
        { text: 'Not now', role: 'cancel' },
        {
          text: 'Sign In',
          handler: () => { this.goSignIn(); },
        },
      ],
    });
    await alert.present();
  }

  /** Shareable link that reopens this post in the feed (web builds only). */
  private postLink(post: Post): string | null {
    if (!location.protocol.startsWith('http')) return null;
    return `${location.origin}/tabs/community?post=${encodeURIComponent(post.id)}`;
  }

  private focusPost(id: string, found: boolean) {
    this.focusId.set(null);
    if (!found) {
      this.toast('That post isn\'t available anymore.');
      return;
    }
    this.filter.set('latest');
    setTimeout(async () => {
      const el = document.getElementById('post-' + id);
      const scrollEl = await this.content?.getScrollElement();
      if (el && scrollEl) {
        const top = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop - 12;
        this.content?.scrollToPoint(0, top, 400);
      }
      this.highlightId.set(id);
      setTimeout(() => this.highlightId.set(null), 2600);
    }, 120);
  }

  private async copy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  private message(e: unknown): string {
    return e instanceof CommunityError ? e.message : 'Something went wrong. Please try again.';
  }

  private async toast(message: string, color: 'dark' | 'success' | 'danger' = 'dark') {
    const toast = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await toast.present();
  }
}
