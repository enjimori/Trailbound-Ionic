/**
 * Explore-page controller: coordinates trail discovery, filtering, location/map state, and navigation to each trail?s details.
 */
import { Component, OnDestroy, ViewChild, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonSearchbar, IonSegment,
  IonSegmentButton, IonLabel, IonIcon, IonButton, IonModal, ViewDidEnter,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  cloudOutline, close, bookmark, bookmarkOutline, navigateOutline,
  layersOutline, locationOutline, mapOutline, star, navigate,
  playCircleOutline, videocamOutline, informationCircleOutline, imageOutline,
  calendarOutline, documentTextOutline, openOutline,
} from 'ionicons/icons';

import { TrailMapComponent } from './trail-map/trail-map.component';
import { TrailWeatherComponent } from './trail-weather.component';
import { isClosed, geoFor } from './trail-geo';
import { photoFor, hasPhoto as hasPhotoFor, TrailPhoto } from './trail-photos';
import { videoFor, embedUrlFor, isPlayable } from './trail-videos';
import { TRAILS_30 } from './explore-trails.data';
import { TrailService } from '../../services/trail.service';
import { CatalogService } from '../../services/catalog.service';
import { TrailStatusService } from '../../services/trail-status.service';
import { UserService } from '../../services/user.service';
import { WeatherService } from '../../services/weather.service';
import { Trail } from '../../models/trail.model';

addIcons({
  cloudOutline, close, bookmark, bookmarkOutline, navigateOutline,
  layersOutline, locationOutline, mapOutline, star, navigate,
  playCircleOutline, videocamOutline, informationCircleOutline, imageOutline,
  calendarOutline, documentTextOutline, openOutline,
});

@Component({
  selector: 'app-explore',
  standalone: true,
  templateUrl: './explore.page.html',
  styleUrls: ['./explore.page.scss'],
  imports: [
    CommonModule, IonContent, IonHeader, IonToolbar, IonTitle, IonSearchbar,
    IonSegment, IonSegmentButton, IonLabel, IonIcon, IonButton, IonModal,
    TrailMapComponent, TrailWeatherComponent,
  ],
})
export class ExplorePage implements ViewDidEnter, OnDestroy {
  @ViewChild(TrailMapComponent) private trailMap?: TrailMapComponent;

  /**
   * A trail id handed over from the detail page's "View map, route & video"
   * button. Held until the map exists, because the query parameter can arrive
   * before Leaflet has finished initialising.
   */
  private pendingFocusId: string | null = null;
  private queryParamSub?: Subscription;
  searchTerm = signal('');
  difficultyFilter = signal<'All' | 'Easy' | 'Moderate' | 'Hard'>('All');
  selectedTrail = signal<Trail | null>(null);
  showWeatherAlert = signal(true);
  routeShown = signal(false);
  showSavedPanel = signal(false);
  showVideo = signal(false);

  /** Re-exported so the template can call them. */
  readonly isClosed = isClosed;

  /** Photo for a trail, or the illustrative placeholder when none exists. */
  photo(trail: Trail): TrailPhoto {
    return photoFor(trail.id);
  }

  /** True only when a real photograph of this mountain is on file. */
  hasPhoto(trail: Trail): boolean {
    return hasPhotoFor(trail.id);
  }

  /** Shows the built-in Explore dataset together with admin-added catalog trails. */
  results = computed(() => {
    const q = this.searchTerm().trim().toLowerCase();
    const matchesQuery = (trail: Trail) =>
      !q || `${trail.name} ${trail.region} ${trail.description}`.toLowerCase().includes(q);
    const all = this.catalog.withTrailOverrides(TRAILS_30).filter(matchesQuery);
    const custom = this.catalog.withTrailOverrides(this.trailService.addedTrails()).filter(matchesQuery);
    const matchesDifficulty = (trail: Trail) =>
      this.difficultyFilter() === 'All' || trail.difficulty === this.difficultyFilter();
    return [...all, ...custom].filter(matchesDifficulty);
  });

  /**
   * The old generic banner, still fed by the shared WeatherService. It is
   * hidden the moment a trail is selected, because that trail's own forecast
   * appears in the sheet and the two must never contradict each other.
   */
  weather = computed(() => this.weatherService.current());

  // ── trail video ─────────────────────────────────────────────────────────

  /** The video or article recorded for the open trail, if any. */
  activeVideo = computed(() => {
    const t = this.selectedTrail();
    return t ? videoFor(t.id) : undefined;
  });

  /** True when it can play inside the app rather than opening the browser. */
  canPlayVideo = computed(() => isPlayable(this.activeVideo()));

  /**
   * Angular refuses to bind an arbitrary string to an iframe `src`, because
   * that is exactly how a malicious URL would get executed in the page. These
   * URLs are built by us from a fixed id, so marking them trusted is safe —
   * but it must be done deliberately, which is the point of the API.
   */
  videoEmbedUrl = computed<SafeResourceUrl | null>(() => {
    const v = this.activeVideo();
    const url = v ? embedUrlFor(v) : null;
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  /**
   * The button says what will actually happen. Eleven of the thirty links are
   * articles, not videos — calling those "Watch trail video" would be a
   * promise the app does not keep.
   */
  videoLabel = computed(() => {
    const v = this.activeVideo();
    if (!v) return 'No trail video yet';
    return v.kind === 'page' ? 'Read trail guide' : 'Watch trail video';
  });

  videoIcon = computed(() => {
    const v = this.activeVideo();
    if (!v) return 'videocam-outline';
    return v.kind === 'page' ? 'document-text-outline' : 'play-circle-outline';
  });

  /**
   * Saved trails, resolved from UserService.upcoming() back to the Explore
   * catalog. Saving writes to the shared UserService, so built-in and
   * admin-added trails appear here and in the Profile tab.
   */
  // LOOP: walk the saved ids once and map them back to the Explore catalog.
  // This keeps the bookmark list synced with the shared user data store.
  savedTrails = computed(() => {
    const ids = new Set(this.userService.upcoming().map(u => u.trailId));
    return this.catalog
      .withTrailOverrides([...TRAILS_30, ...this.trailService.addedTrails()])
      .filter(t => ids.has(t.id));
  });

  private readonly trailStatus = inject(TrailStatusService);
  private readonly catalog = inject(CatalogService);

  constructor(
    public trailService: TrailService,
    private userService: UserService,
    private weatherService: WeatherService,
    private sanitizer: DomSanitizer,
    private route: ActivatedRoute,
    private router: Router,
    private toastCtrl: ToastController,
  ) {
    // ?trail=T004 — sent by the detail page. Ionic keeps tab pages alive, so
    // this must watch the parameter rather than read a snapshot once.
    this.queryParamSub = this.route.queryParamMap.subscribe(params => {
      const id = params.get('trail');
      if (!id) return;

      const found = TRAILS_30.find(t => t.id === id) ?? this.trailService.getById(id);
      if (!found) return;
      const trail = this.catalog.withTrailOverrides([found])[0];

      this.selectedTrail.set(trail);
      this.pendingFocusId = id;
      this.trailMap?.focusTrail(trail);

      // Clear the parameter so arriving at the SAME trail twice in a row
      // still fires. Identical query params emit nothing the second time,
      // and the second tap would appear to do nothing at all.
      setTimeout(() => {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {},
          replaceUrl: true,
        });
      });
    });
  }

  /** Runs when the component is removed; releases resources owned by this component. */
  ngOnDestroy() {
    this.queryParamSub?.unsubscribe();
  }

  /**
   * Ionic keeps pages mounted, so the map container can measure zero until the
   * enter transition finishes. The component self-heals via ResizeObserver,
   * but nudging it here avoids a visible reflow on first paint.
   */
  ionViewDidEnter() {
    requestAnimationFrame(() => {
      this.trailMap?.refreshSize();

      // A trail handed over from the detail page: fly to it now that the map
      // is laid out and measurable.
      const id = this.pendingFocusId;
      if (id) {
        const trail = TRAILS_30.find(t => t.id === id);
        if (trail) this.trailMap?.focusTrail(trail);
        this.pendingFocusId = null;
      }
    });
  }

  /** Handles search input and updates the matching trail results. */
  onSearch(ev: any) {
    this.searchTerm.set(ev.detail.value ?? '');
    this.clearSelectionIfFiltered();
  }

  /** Updates the selected explore segment and its corresponding results. */
  onSegmentChange(ev: any) {
    this.difficultyFilter.set(ev.detail.value);
    this.clearSelectionIfFiltered();
  }

  /** Receives a map selection and updates the selected trail shown by the page. */
  onMapSelect(trail: Trail) {
    this.selectedTrail.set(trail);
    // A route belongs to the trail it was drawn for.
    this.trailMap?.clearRoute();
    this.routeShown.set(false);
  }

  /** Closes or cancels the close sheet flow and returns the interface to its previous state. */
  closeSheet() {
    this.selectedTrail.set(null);
    this.trailMap?.clearRoute();
    this.routeShown.set(false);
    // Closing the sheet must stop the video too, or audio keeps playing from
    // a trail the user is no longer looking at.
    this.showVideo.set(false);
  }

  /** Moves the map view to the current user location when available. */
  centerOnUser() {
    this.trailMap?.centerOnUser().then(coords => {
      if (!coords) this.toast('Location unavailable. Check permissions.');
    });
  }

  /**
   * Cycles Dark -> Satellite -> Street -> Light. With four styles the button
   * alone no longer tells you where you are in the cycle, so name the result.
   */
  toggleLayers() {
    const label = this.trailMap?.cycleBasemap();
    if (label) this.toast(label);
  }

  /** Adds or removes the trail from the user?s saved list. */
  async toggleBookmark(trail: Trail) {
    if (this.isSaved(trail)) {
      const existing = this.userService.upcoming().find(u => u.trailId === trail.id);
      if (existing) this.userService.removeUpcoming(existing.id);
      this.toast('Removed from saved trails');
      return;
    }

    this.userService.addUpcoming({
      id: 'u' + Date.now(),
      trailId: trail.id,
      name: trail.name,
      image: trail.image,
      date: 'To be scheduled',
      duration: trail.duration,
    });
    this.toast('Saved — find it under the bookmark icon');
  }

  /** Whether this trail is in the user's saved list. */
  isSaved(trail: Trail): boolean {
    return this.userService.upcoming().some(u => u.trailId === trail.id);
  }

  /** Shows or hides the panel containing saved trails. */
  toggleSavedPanel() {
    this.showSavedPanel.update(open => !open);
  }

  /** Opens a saved trail: closes the panel, selects it, flies the map to it. */
  selectFromSaved(trail: Trail) {
    this.showSavedPanel.set(false);
    this.onMapSelect(trail);
    this.trailMap?.focusTrail(trail);
  }

  /** Removes from the panel without opening the trail. */
  removeSaved(trail: Trail, ev: Event) {
    ev.stopPropagation();
    const existing = this.userService.upcoming().find(u => u.trailId === trail.id);
    if (existing) this.userService.removeUpcoming(existing.id);
  }

  /** Closes or cancels the dismiss weather alert flow and returns the interface to its previous state. */
  dismissWeatherAlert() {
    this.showWeatherAlert.set(false);
  }

  /** Connects the details button on Home and Explore to the detail page. */
  openTrail(trail: Trail) {
    this.router.navigate(['/trail', trail.id]);
  }

  /**
   * Hands off to whatever map app the device uses, with the trail as
   * destination. No routing service, no API key, no quota.
   *
   * Worth being honest with users about in the UI copy: this navigates to the
   * trail's coordinates, which is the jump-off point. No consumer routing
   * service has the hiking trail itself, so this stops where the road does.
   */
  openDirections(trail: Trail) {
    const geo = geoFor(trail.id, trail);
    if (!geo) {
      this.toast('No coordinates recorded for this trail');
      return;
    }
    const url =
      'https://www.google.com/maps/dir/?api=1' +
      `&destination=${geo.lat},${geo.lng}` +
      '&travelmode=driving';
    window.open(url, '_blank');
  }

  /**
   * Plays the video in a modal when the platform allows embedding; opens the
   * browser when the link is an article. Nothing happens silently.
   */
  onVideoTap() {
    const v = this.activeVideo();
    if (!v) {
      this.toast('No trail video recorded for this one yet');
      return;
    }
    // SWITCH / BRANCH LOGIC: decide whether to open an external trail guide or
    // embed the playable video in the modal based on the media kind.
    if (v.kind === 'page') {
      window.open(v.url, '_blank');
      return;
    }
    this.showVideo.set(true);
  }

  /**
   * `isOpen` back to false actually removes the iframe from the DOM, which is
   * how the video stops. Hiding it with CSS would leave the audio running.
   */
  closeVideo() {
    this.showVideo.set(false);
  }

  /**
   * Toggles the recorded route for the selected trail. Routes come from real
   * GPX tracks converted by tools/gpx-to-path.mjs — if a trail has no track
   * yet, say so rather than drawing an approximation.
   */
  onTrailMapTap() {
    const trail = this.selectedTrail();
    if (!trail || !this.trailMap) return;

    if (this.trailMap.hasRoute()) {
      this.trailMap.clearRoute();
      this.routeShown.set(false);
      return;
    }

    const drawn = this.trailMap.showRoute(trail.id);
    this.routeShown.set(drawn);

    if (!drawn) {
      this.toast('No recorded route for this trail yet');
    }
  }

  /** Starts the booking route for the trail currently being viewed. */
  bookNow(trail: Trail) {
    // Closed from Admin → Trails: keep hikers out of the booking flow.
    if (this.trailStatus.closureFor(trail.id)) {
      this.toast('This trail is closed for booking right now');
      return;
    }
    this.router.navigate(['/booking', trail.id]);
  }

  /** Drop the open sheet if its trail is no longer in the filtered set. */
  private clearSelectionIfFiltered() {
    const trail = this.selectedTrail();
    if (trail && !this.results().some(t => t.id === trail.id)) {
      this.selectedTrail.set(null);
      this.showVideo.set(false);
    }
  }

  /** Shows a brief Ionic notification so the user can understand the action result. */
  private async toast(message: string) {
    const t = await this.toastCtrl.create({
      message, duration: 1600, position: 'top', color: 'dark',
    });
    t.present();
  }
}