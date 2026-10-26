/**
 * Trail-detail controller: resolves the selected trail, loads related information, and connects trail actions such as booking to their next screens.
 */
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent, IonButton, IonIcon, IonTextarea, IonInput, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { lockClosedOutline, mapOutline } from 'ionicons/icons';

import { TrailService } from '../../services/trail.service';
import { CatalogService } from '../../services/catalog.service';
import { UserService } from '../../services/user.service';
import { ReviewService, TrailReview } from '../../services/review.service';
import { TrailStatusService } from '../../services/trail-status.service';
import { WishlistService } from '../../services/wishlist.service';
import { Trail } from '../../models/trail.model';

// Falls back to the 30-trail dataset for ids TrailService does not hold.
import { trailById } from '../explore/trail-lookup';
import { storyFor } from '../explore/trail-stories';
import { TrailWeatherComponent } from '../explore/trail-weather.component';

// Registered here rather than relying on Explore having been opened first —
// module-level addIcons only runs once that page's chunk has loaded, and a
// user can land on this page directly from a deep link.
addIcons({ mapOutline, lockClosedOutline });

@Component({
  selector: 'app-trail-detail',
  standalone: true,
  templateUrl: './trail-detail.page.html',
  styleUrls: ['./trail-detail.page.scss'],
  imports: [
    CommonModule, FormsModule, IonContent, IonButton, IonIcon,
    IonTextarea, IonInput, TrailWeatherComponent,
  ],
})
export class TrailDetailPage implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly wishlist = inject(WishlistService);
  trail = signal<Trail | undefined>(undefined);

  /**
   * Whether the heart is filled. Read live from the wishlist, so it stays
   * right when the trail is hearted elsewhere (Home, Explore) or the profile
   * finishes loading after this page opened.
   */
  saved = computed(() => {
    const t = this.trail();
    return t ? this.wishlist.has(t.id) : false;
  });

  /** Set when an admin has closed this trail for booking. */
  closure = computed(() => {
    const t = this.trail();
    return t ? this.trailStatus.closureFor(t.id) : null;
  });

  /** Editorial content — tagline, why-hike bullets, long-form story. */
  story = computed(() => {
    const t = this.trail();
    return t ? storyFor(t.id) : undefined;
  });

  // ── reviews ─────────────────────────────────────────────────────────────

  /** Bumped after each write so the computed values below re-read the store. */
  private reviewTick = signal(0);

  reviews = computed(() => {
    this.reviewTick();
    const t = this.trail();
    return t ? this.reviewService.forTrail(t.id) : [];
  });

  averageRating = computed(() => {
    this.reviewTick();
    const t = this.trail();
    return t ? this.reviewService.averageFor(t.id) : 0;
  });

  reviewCount = computed(() => this.reviews().length);

  /** Whole stars to fill in the summary row. */
  readonly starSlots = [1, 2, 3, 4, 5];

  showReviewForm = signal(false);
  draftAuthor = '';
  draftRating = signal(0);
  draftText = '';

  constructor(
    private route: ActivatedRoute,
    private location: Location,
    private router: Router,
    private trailService: TrailService,
    private userService: UserService,
    private reviewService: ReviewService,
    private toastCtrl: ToastController,
    private trailStatus: TrailStatusService,
  ) {}

  /** Runs when the component initializes; prepares the state its template needs. */
  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      // TrailService holds the 6 seeded trails (t1-t6); the Explore dataset
      // holds the 30 Philippine trails (T001-T030). Check both, or every card
      // on Home and every marker on the map lands on "Trail not found".
      const found = this.trailService.getById(id) ?? trailById(id);
      this.trail.set(found ? this.catalog.withTrailOverrides([found])[0] : undefined);

      // Pre-fill the reviewer name from the profile, since we know it.
      this.draftAuthor = this.userService.profile().name;
    }
  }

  // ── review form ─────────────────────────────────────────────────────────

  toggleReviewForm() {
    this.showReviewForm.update(open => !open);
  }

  /** Stores the set draft rating selection so the related view and feature logic stay in sync. */
  setDraftRating(n: number) {
    this.draftRating.set(n);
  }

  /** Performs the submit review operation for this feature and returns its result to the caller. */
  async submitReview() {
    const t = this.trail();
    if (!t) return;

    if (this.draftRating() < 1) {
      this.toast('Pick a star rating first');
      return;
    }
    if (!this.draftText.trim()) {
      this.toast('Add a few words about your hike');
      return;
    }

    this.reviewService.add(t.id, this.draftAuthor, this.draftRating(), this.draftText);
    this.reviewTick.update(n => n + 1);

    this.draftText = '';
    this.draftRating.set(0);
    this.showReviewForm.set(false);
    this.toast('Review posted');
  }

  /** Only the author (or a guest, for their own device-only reviews) may delete. */
  canDeleteReview(r: TrailReview): boolean {
    return this.reviewService.canDelete(r);
  }

  /** Performs the delete review operation for this feature and returns its result to the caller. */
  deleteReview(id: string) {
    this.reviewService.remove(id);
    this.reviewTick.update(n => n + 1);
  }

  /** Performs the time ago operation for this feature and returns its result to the caller. */
  timeAgo(iso: string): string {
    return this.reviewService.timeAgo(iso);
  }

  // ── existing behaviour ──────────────────────────────────────────────────

  goBack() {
    this.location.back();
  }

  /**
   * Opens the Explore tab with this mountain already selected, so its sheet
   * is showing — map, route, "How to get there" and the trail video.
   *
   * The id travels as a query parameter rather than router state, because
   * router state does not survive a reload and a deep link to the map with a
   * trail open is genuinely useful.
   */
  viewOnMap() {
    const t = this.trail();
    if (!t) return;
    this.router.navigate(['/tabs/explore'], { queryParams: { trail: t.id } });
  }

  /** Hearts or un-hearts this trail (the Profile tab's Wishlist). */
  toggleSave() {
    const t = this.trail();
    if (!t) return;
    void this.wishlist.toggle(t);
  }

  /** Starts the hike-related action for the selected trail. */
  async startHike() {
    this.toast('Hike started! Stay safe on the trails. 🥾', 'success');
  }

  /** Starts the booking route for the trail currently being viewed. */
  bookNow() {
    const t = this.trail();
    if (!t) return;
    if (this.closure()) {
      this.toast('This trail is closed for booking right now.');
      return;
    }
    this.router.navigate(['/booking', t.id]);
  }

  /** Shows a brief Ionic notification so the user can understand the action result. */
  private async toast(message: string, color: string = 'dark') {
    const t = await this.toastCtrl.create({
      message, duration: 1800, position: 'top', color,
    });
    t.present();
  }
}