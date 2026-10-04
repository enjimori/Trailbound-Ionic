import { Component, OnDestroy, ViewChild, computed, signal } from '@angular/core';
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
import { searchTrails, TRAILS_30 } from './explore-trails.data';
import { TrailService } from '../../services/trail.service';
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

  /**
   * Reads the Explore module's own 30-trail dataset, not TrailService. The
   * shared service holds demo seed data that other pages depend on by id.
   */
  results = computed(() => {
    const all = searchTrails(this.searchTerm());
    if (this.difficultyFilter() === 'All') return all;
    return all.filter(t => t.difficulty === this.difficultyFilter());
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
   * dataset. Saving writes to the shared UserService, so a trail saved here
   * also appears in the Profile tab — same store the detail page writes to.
   */
  savedTrails = computed(() => {
    const ids = new Set(this.userService.upcoming().map(u => u.trailId));
    return TRAILS_30.filter(t => ids.has(t.id));
  });

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

      const trail = TRAILS_30.find(t => t.id === id);
      if (!trail) return;

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

  onSearch(ev: any) {
    this.searchTerm.set(ev.detail.value ?? '');
    this.clearSelectionIfFiltered();
  }

  onSegmentChange(ev: any) {
    this.difficultyFilter.set(ev.detail.value);
    this.clearSelectionIfFiltered();
  }

  onMapSelect(trail: Trail) {
    this.selectedTrail.set(trail);
    // A route belongs to the trail it was drawn for.
    this.trailMap?.clearRoute();
    this.routeShown.set(false);
  }

  closeSheet() {
    this.selectedTrail.set(null);
    this.trailMap?.clearRoute();
    this.routeShown.set(false);
    // Closing the sheet must stop the video too, or audio keeps playing from
    // a trail the user is no longer looking at.
    this.showVideo.set(false);
  }

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
    const geo = geoFor(trail.id);
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

  bookNow(trail: Trail) {
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

  private async toast(message: string) {
    const t = await this.toastCtrl.create({
      message, duration: 1600, position: 'top', color: 'dark',
    });
    t.present();
  }
}