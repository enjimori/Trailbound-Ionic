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
  cloudOfflineOutline, star, starOutline, repeatOutline, timeOutline, searchOutline, personOutline,
} from 'ionicons/icons';
import { PostCardComponent } from '../../components/post-card/post-card.component';
import { PeopleSheetComponent } from '../../components/people-sheet/people-sheet.component';
import { FollowService, PersonSummary } from '../../services/follow.service';
import { MentionService } from '../../services/mention.service';
import {
  ActiveMention, MentionRef, activeMention, insertMention, pruneMentions,
} from '../../services/mention.util';
import { MentionTextComponent } from '../../components/mention-text/mention-text.component';
import { MentionSuggestionsComponent } from '../../components/mention-suggestions/mention-suggestions.component';
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

type FeedFilter = 'latest' | 'top' | 'following' | 'mine';

@Component({
  selector: 'app-community',
  standalone: true,
  templateUrl: './community.page.html',
  styleUrls: ['./community.page.scss'],
  imports: [
    CommonModule, FormsModule, IonContent, IonHeader, IonFooter, IonToolbar, IonIcon, IonBadge,
    IonModal, IonTextarea, IonSpinner, PostCardComponent, PeopleSheetComponent, AppLogoComponent,
    MentionSuggestionsComponent, MentionTextComponent,
  ],
})
export class CommunityPage {
  readonly postService = inject(PostService);
  readonly notificationService = inject(NotificationService);
  readonly userService = inject(UserService);
  readonly follows = inject(FollowService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly mentionService = inject(MentionService);

  @ViewChild(IonContent) private content?: IonContent;
  @ViewChild('composerModal') private composerModal?: IonModal;
  @ViewChild('photoInput') private photoInput?: ElementRef<HTMLInputElement>;
  @ViewChild('composerText') private composerText?: IonTextarea;

  readonly POST_TEXT_MAX = POST_TEXT_MAX;
  readonly COMMENT_TEXT_MAX = COMMENT_TEXT_MAX;
  readonly POST_PHOTO_MAX = POST_PHOTO_MAX;
  readonly ratingStars = [1, 2, 3, 4, 5];

  // ── feed ────────────────────────────────────────────────────────────────
  readonly filter = signal<FeedFilter>('latest');

  /** "My posts" and "Following" fall back to Latest once nobody is signed in. */
  readonly activeFilter = computed<FeedFilter>(() => {
    const f = this.filter();
    return (f === 'mine' || f === 'following') && !this.userService.isAuthenticated() ? 'latest' : f;
  });

  readonly visiblePosts = computed<Post[]>(() => {
    const posts = this.postService.posts();
    switch (this.activeFilter()) {
      case 'mine':
        return posts.filter((p) => p.isMine);
      case 'following': {
        const following = this.follows.followingUids();
        return posts.filter((p) => following.has(p.authorUid));
      }
      case 'top':
        // A repost ranks by the post it shares.
        return [...posts].sort((a, b) => {
          const pa = a.original ?? a;
          const pb = b.original ?? b;
          return pb.score + pb.commentCount - (pa.score + pa.commentCount);
        });
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
  /** 0 = no rating, otherwise 1–5 stars for the tagged trail. */
  draftRating = 0;
  /** The guide being tagged on this post, if any. */
  draftGuide: { uid: string; name: string } | null = null;
  processingPhotos = false;
  publishing = false;
  showTrailPicker = false;
  trailQuery = '';
  /** Set right before a programmatic close, so "Discard post?" is skipped. */
  private skipDiscardCheck = false;
  /** Photos picked before the composer was open (camera shortcut). */
  private pendingFiles: File[] = [];

  // ── @mentions ───────────────────────────────────────────────────────────
  postMentions: MentionRef[] = [];
  commentMentions: MentionRef[] = [];
  composerSuggestions: PersonSummary[] = [];
  commentSuggestions: PersonSummary[] = [];
  private composerMention: ActiveMention | null = null;
  private commentMention: ActiveMention | null = null;
  private commentBoxEl: HTMLInputElement | null = null;

  // ── comments ────────────────────────────────────────────────────────────
  showComments = false;
  newComment = '';
  sendingComment = false;

  // ── people (search + profiles) ──────────────────────────────────────────
  showPeople = false;
  peopleUid: string | null = null;
  /** The sheet is picking a guide for the composer instead of browsing people. */
  peoplePick = false;

  // ── edit history ────────────────────────────────────────────────────────
  showHistory = false;
  readonly historyPost = computed(() => this.postService.postById(this.postService.historyPostId()));

  readonly activePost = computed(() => this.postService.postById(this.postService.threadPostId()));

  // ── photo viewer ────────────────────────────────────────────────────────
  viewer: { images: string[]; index: number } | null = null;

  constructor() {
    addIcons({
      imagesOutline, closeCircle, refreshOutline, copyOutline, chevronDownOutline, createOutline,
      cloudOfflineOutline, star, starOutline, repeatOutline, timeOutline, searchOutline, personOutline,
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

  /** Search button in the header. */
  openPeople() {
    this.peoplePick = false;
    this.peopleUid = null;
    this.showPeople = true;
  }

  /** A name or photo on a post was tapped. */
  openProfile(uid: string) {
    this.peoplePick = false;
    this.peopleUid = uid;
    this.showPeople = true;
  }

  onPeopleClosed() {
    this.showPeople = false;
    this.peopleUid = null;
    this.peoplePick = false;
  }

  /** What the feed says when the current filter has no posts. */
  get emptyMessage(): string {
    switch (this.activeFilter()) {
      case 'mine':
        return 'You haven\'t posted yet.';
      case 'following':
        return this.follows.followingCount() === 0
          ? 'You\'re not following anyone yet. Find hikers to follow!'
          : 'No recent posts from the people you follow.';
      default:
        return 'No posts yet. Be the first to share a hike!';
    }
  }

  setFilter(f: FeedFilter) {
    if ((f === 'mine' || f === 'following') && !this.isSignedIn) {
      this.askToSignIn(f === 'mine' ? 'see your posts' : 'see posts from people you follow');
      return;
    }
    this.filter.set(f);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Votes / reposts / share / menu
  // ═══════════════════════════════════════════════════════════════════════

  async onVote(ev: { post: Post; dir: 1 | -1 }) {
    if (!this.isSignedIn) {
      this.askToSignIn(ev.dir === 1 ? 'upvote posts' : 'downvote posts');
      return;
    }
    try {
      await this.postService.vote(ev.post, ev.dir);
    } catch (e) {
      this.toast(this.message(e), 'danger');
    }
  }

  async onRepost(post: Post) {
    if (!this.isSignedIn) {
      this.askToSignIn('repost');
      return;
    }
    try {
      const result = await this.postService.toggleRepost(post);
      this.toast(result === 'reposted' ? 'Reposted to the community' : 'Repost removed', 'success');
    } catch (e) {
      this.toast(this.message(e), 'danger');
    }
  }

  private async removeRepost(repost: Post) {
    try {
      await this.postService.removeRepost(repost);
      this.toast('Repost removed');
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
    // For a repost, post = the repost and target = the post it shares.
    const target = post.original ?? post;
    const hasContent = !post.isRepost || !!post.original;
    const buttons: any[] = [];

    if (post.isRepost && post.isMine) {
      buttons.push({ text: 'Remove repost', icon: 'repeat-outline', role: 'destructive', handler: () => { this.removeRepost(post); } });
    }
    if (!post.isRepost && post.isMine) {
      buttons.push(
        { text: 'Edit post', icon: 'create-outline', handler: () => { this.openEditor(post); } },
        { text: 'Delete post', icon: 'trash-outline', role: 'destructive', handler: () => { this.confirmDeletePost(post); } },
      );
    }
    if (hasContent) {
      buttons.push({ text: 'Share post', icon: 'share-social-outline', handler: () => { this.onShare(target); } });
      if (target.content) {
        buttons.push({
          text: 'Copy text',
          icon: 'copy-outline',
          handler: () => {
            this.copy(target.content).then((ok) => this.toast(ok ? 'Text copied' : 'Couldn\'t copy on this device.'));
          },
        });
      }
      if (target.edited) {
        buttons.push({ text: 'View edit history', icon: 'time-outline', handler: () => { this.openHistory(target); } });
      }
      if (target.trailId) {
        buttons.push({ text: `View ${target.trailName || 'trail'}`, icon: 'location-outline', handler: () => { this.openTrail(target); } });
      }
    }
    buttons.push({ text: 'Cancel', role: 'cancel' });

    const header = post.isRepost
      ? (post.isMine ? 'Your repost' : `${post.author}'s repost`)
      : (post.isMine ? 'Your post' : post.author);
    const sheet = await this.actionSheetCtrl.create({ header, buttons });
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
    this.draftRating = post.trailId ? (post.rating ?? 0) : 0;
    this.draftGuide = post.guide ? { uid: post.guide.uid, name: post.guide.name } : null;
    this.showComposer = true;
  }

  get canPublish(): boolean {
    return !this.publishing && !this.processingPhotos
      && (this.draftText.trim().length > 0 || this.draftImages.length > 0)
      && this.draftText.length <= POST_TEXT_MAX;
  }

  private get isDirty(): boolean {
    return !!(this.draftText.trim() || this.draftImages.length || this.draftTrail || this.draftGuide);
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
    this.draftRating = 0;
    this.draftGuide = null;
    this.postMentions = [];
    this.composerSuggestions = [];
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

  /** "Tag a guide": the people sheet opens on top of the composer in pick mode. */
  openGuidePicker() {
    this.peopleUid = null;
    this.peoplePick = true;
    this.showPeople = true;
  }

  onGuidePicked(p: { uid: string; name: string }) {
    if (p.uid === this.postService.myUid()) {
      this.toast("You can't tag yourself as your own guide.", 'danger');
      return;
    }
    this.draftGuide = { uid: p.uid, name: p.name };
  }

  clearGuide() {
    this.draftGuide = null;
  }

  clearTrail() {
    this.draftTrail = null;
    this.draftRating = 0;
  }

  /** Tapping the star you already chose clears the rating. */
  setRating(stars: number) {
    this.draftRating = this.draftRating === stars ? 0 : stars;
  }

  // ── @mentions ───────────────────────────────────────────────────────────

  /** New posts: only people you follow (a new post has no author or commenters yet). */
  async onComposerInput() {
    const el = await this.composerText?.getInputElement();
    const caret = el?.selectionStart ?? this.draftText.length;
    this.composerMention = activeMention(this.draftText, caret);
    this.composerSuggestions = this.composerMention
      ? await this.mentionService.suggest(this.composerMention.query)
      : [];
  }

  async pickComposerMention(p: PersonSummary) {
    if (!this.composerMention) return;
    const el = await this.composerText?.getInputElement();
    const caret = el?.selectionStart ?? this.draftText.length;
    const r = insertMention(this.draftText, this.composerMention, caret, p.name);
    this.draftText = r.text;
    this.postMentions = [...this.postMentions, { uid: p.uid, name: p.name }];
    this.composerSuggestions = [];
    this.composerMention = null;
    setTimeout(() => { el?.focus(); el?.setSelectionRange(r.caret, r.caret); });
  }

  /** Comments: the post's author, its commenters, and people you follow. */
  async onCommentInput(box: HTMLInputElement) {
    this.commentBoxEl = box;
    this.commentMention = activeMention(this.newComment, box.selectionStart ?? this.newComment.length);
    const post = this.activePost();
    const t = post?.original ?? post;
    const extra = t
      ? [
          { uid: t.authorUid, name: t.author, avatar: t.avatar },
          ...this.postService.comments().map((c) => ({ uid: c.authorUid, name: c.author, avatar: c.avatar })),
        ]
      : [];
    this.commentSuggestions = this.commentMention
      ? await this.mentionService.suggest(this.commentMention.query, extra)
      : [];
  }

  pickCommentMention(p: PersonSummary) {
    const box = this.commentBoxEl;
    if (!this.commentMention || !box) return;
    const r = insertMention(this.newComment, this.commentMention, box.selectionStart ?? this.newComment.length, p.name);
    this.newComment = r.text;
    this.commentMentions = [...this.commentMentions, { uid: p.uid, name: p.name }];
    this.commentSuggestions = [];
    this.commentMention = null;
    setTimeout(() => { box.focus(); box.setSelectionRange(r.caret, r.caret); });
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
        rating: this.draftTrail && this.draftRating ? this.draftRating : undefined,
        guideUid: this.draftGuide?.uid,
        guideName: this.draftGuide?.name,
        mentions: pruneMentions(this.draftText, this.postMentions),
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
    this.commentMentions = [];
    this.commentSuggestions = [];
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
      const result = await this.postService.addComment(post.id, text, pruneMentions(text, this.commentMentions));
      this.newComment = '';
      this.commentMentions = [];
      this.commentSuggestions = [];
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
  //  Edit history
  // ═══════════════════════════════════════════════════════════════════════

  openHistory(post: Post) {
    this.postService.openHistory(post.id);
    this.showHistory = true;
  }

  onHistoryDismissed() {
    this.showHistory = false;
    this.postService.closeHistory();
  }

  /** Edited before history was recorded, so only the current version exists. */
  get historyIsPartial(): boolean {
    return !!this.historyPost()?.edited
      && !this.postService.historyLoading()
      && !this.postService.historyError()
      && this.postService.versions().length <= 1;
  }

  openVersionPhoto(images: string[], index: number) {
    this.viewer = { images, index };
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
