/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TRAIL NAVIGATION — TrailBound Basic   (/navigate/:id, from "Start Hike")
 *
 * A live map for the climb:
 *   • your position (GPS), the summit, and a line between them
 *   • distance and compass direction to the summit, height still to climb
 *   • your walked track, time on trail and distance walked
 *   • the recorded trail route when trail-paths.ts has one, with a warning
 *     if you wander more than 150 m from it
 *   • directions to the jump-off, share-my-location and an SOS call button
 *
 * Map: Esri World Topo (contour lines) or satellite — the same keyless Esri
 * service the Explore map already uses for its satellite layer.
 * Locked without a plan: the page shows what it does and an unlock button.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, IonIcon, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline, callOutline, carOutline, flagOutline, layersOutline, locateOutline,
  navigateOutline, pauseOutline, playOutline, shareSocialOutline, stopOutline, warningOutline,
} from 'ionicons/icons';
import * as L from 'leaflet';

import { Trail } from '../models/trail.model';
import { SubscriptionService } from '../services/subscription.service';
import { CatalogService } from '../services/catalog.service';
import { TrailService } from '../services/trail.service';
import { geoFor } from '../pages/explore/trail-geo';
import { pathFor } from '../pages/explore/trail-paths';
import { distanceKm } from '../pages/explore/trail-lookup';
import { LockedFeatureComponent } from './locked-feature.component';
import { WeatherMonitorComponent } from './weather-monitor.component';
import { findTrail, parseMetres } from './premium';

const TOPO_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI = 'Tiles &copy; <a href="https://www.esri.com">Esri</a> and contributors';

/** Wander further than this from a recorded route and the app warns you. */
const OFF_ROUTE_KM = 0.15;

interface Fix { lat: number; lng: number; accuracy: number; altitude: number | null; at: number; }

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((bLng - aLng) * r) * Math.cos(bLat * r);
  const x = Math.cos(aLat * r) * Math.sin(bLat * r) - Math.sin(aLat * r) * Math.cos(bLat * r) * Math.cos((bLng - aLng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

@Component({
  selector: 'app-trail-navigation',
  standalone: true,
  imports: [CommonModule, IonContent, IonIcon, LockedFeatureComponent, WeatherMonitorComponent],
  template: `
    <ion-content [fullscreen]="true">
      <div class="nv-top">
        <button class="nv-back" (click)="goBack()" aria-label="Go back"><ion-icon name="arrow-back-outline"></ion-icon></button>
        <div class="nv-title">
          <h1>{{ trail()?.name || 'Trail navigation' }}</h1>
          <span>{{ trail()?.region }}</span>
        </div>
      </div>

      <div class="nv-body" *ngIf="!trail()">
        <p class="nv-msg">Trail not found.</p>
      </div>

      <div class="nv-body" *ngIf="trail() && !unlocked()">
        <app-locked-feature feature="trailNavigation" title="Trail navigation"
          text="A live map while you climb: your position, distance and direction to the summit, your walked track, the trail route, and an SOS button.">
          <div class="nv-stats">
            <div><span class="l">To summit</span><span class="v">2.4 km</span></div>
            <div><span class="l">Direction</span><span class="v">NE 42°</span></div>
            <div><span class="l">Walked</span><span class="v">1.1 km</span></div>
          </div>
        </app-locked-feature>
      </div>

      <ng-container *ngIf="trail() && unlocked()">
        <div class="nv-map-wrap">
          <div #mapHost class="nv-map"></div>
          <div class="nv-fabs">
            <button (click)="toggleLayer()" aria-label="Change map"><ion-icon name="layers-outline"></ion-icon></button>
            <button (click)="centerOnMe()" aria-label="Center on me"><ion-icon name="locate-outline"></ion-icon></button>
          </div>
          <div class="nv-compass" *ngIf="me()" [attr.aria-label]="'Summit is ' + directionText()">
            <ion-icon name="navigate-outline" [style.transform]="'rotate(' + arrowDeg() + 'deg)'"></ion-icon>
          </div>
        </div>

        <div class="nv-body">
          <p class="nv-gps" [class.err]="gpsError()" *ngIf="gpsError() || !me()">
            <ion-icon name="warning-outline" *ngIf="gpsError()"></ion-icon>
            {{ gpsError() || 'Finding your location… allow location access when asked.' }}
          </p>

          <p class="nv-off" *ngIf="offRoute()">
            <ion-icon name="warning-outline"></ion-icon>
            You are about {{ offRoute() | number: '1.0-0' }} m from the trail route. Stop and check with your guide.
          </p>

          <div class="nv-stats">
            <div><span class="l">To summit</span><span class="v">{{ toSummitKm() === null ? '—' : (toSummitKm()! | number: '1.1-1') + ' km' }}</span></div>
            <div><span class="l">Direction</span><span class="v">{{ directionText() }}</span></div>
            <div><span class="l">Climb left</span><span class="v">{{ climbLeft() }}</span></div>
            <div><span class="l">Time</span><span class="v">{{ elapsed() }}</span></div>
            <div><span class="l">Walked</span><span class="v">{{ walkedKm() | number: '1.2-2' }} km</span></div>
            <div><span class="l">GPS accuracy</span><span class="v">{{ me() ? '±' + (me()!.accuracy | number: '1.0-0') + ' m' : '—' }}</span></div>
          </div>

          <div class="nv-actions">
            <button class="nv-main" *ngIf="!tracking()" (click)="startTracking()">
              <ion-icon name="play-outline"></ion-icon>{{ startedAt() ? 'Resume tracking' : 'Start tracking my hike' }}
            </button>
            <button class="nv-main pause" *ngIf="tracking()" (click)="pauseTracking()">
              <ion-icon name="pause-outline"></ion-icon>Pause tracking
            </button>
            <button class="nv-ghost" *ngIf="startedAt()" (click)="finish()"><ion-icon name="stop-outline"></ion-icon>Finish</button>
          </div>

          <div class="nv-links">
            <button (click)="directions()"><ion-icon name="car-outline"></ion-icon>Directions to the jump-off</button>
            <button (click)="shareLocation()"><ion-icon name="share-social-outline"></ion-icon>Share my location</button>
            <a class="sos" href="tel:911"><ion-icon name="call-outline"></ion-icon>SOS · Call 911</a>
          </div>

          <p class="nv-note">
            <ion-icon name="flag-outline"></ion-icon>
            {{ hasRoute ? 'The yellow line is the recorded trail route.' : 'No recorded route for this trail yet, so the line points straight to the summit. Follow your guide and the marked trail.' }}
            GPS works without signal once the map has loaded.
          </p>

          <app-weather-monitor [trail]="trail()"></app-weather-monitor>
        </div>
      </ng-container>
    </ion-content>
  `,
  styles: [`
    .nv-top { display: flex; align-items: center; gap: 10px; padding: calc(10px + env(safe-area-inset-top)) 14px 8px; }
    .nv-back { width: 40px; height: 40px; border: none; border-radius: 12px; background: transparent; color: var(--app-text); display: grid; place-items: center; font-size: 22px; }
    .nv-title { min-width: 0; }
    .nv-title h1 { margin: 0; font-size: 19px; font-weight: 500; color: var(--app-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .nv-title span { font-size: 12px; color: var(--app-text-dim); }
    .nv-map-wrap { position: relative; margin: 0 14px; border-radius: 18px; overflow: hidden; border: 1px solid var(--app-border); }
    .nv-map { height: 46vh; min-height: 260px; background: var(--app-bg-raised); }
    .nv-fabs { position: absolute; right: 10px; top: 10px; z-index: 500; display: flex; flex-direction: column; gap: 8px; }
    .nv-fabs button { width: 40px; height: 40px; border: none; border-radius: 12px; background: rgba(15, 24, 21, 0.85); color: #fff; display: grid; place-items: center; font-size: 19px; }
    .nv-compass { position: absolute; left: 10px; bottom: 10px; z-index: 500; width: 54px; height: 54px; border-radius: 50%; background: rgba(15, 24, 21, 0.85); display: grid; place-items: center; }
    .nv-compass ion-icon { font-size: 28px; color: #e8d99c; transition: transform 0.4s ease; }
    .nv-body { padding: 12px 16px 40px; }
    .nv-msg { color: var(--app-text-dim); }
    .nv-gps, .nv-off { display: flex; gap: 8px; align-items: center; margin: 0 0 10px; padding: 9px 12px; border-radius: 12px; font-size: 12.5px; background: var(--app-bg-raised); color: var(--app-text-dim); }
    .nv-gps.err, .nv-off { color: #e8846b; background: rgba(232, 132, 107, 0.1); }
    .nv-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .nv-stats div { padding: 10px; border-radius: 14px; border: 1px solid var(--app-border); background: var(--app-card-bg); display: flex; flex-direction: column; gap: 2px; }
    .nv-stats .l { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--app-text-dim); }
    .nv-stats .v { font-size: 15px; color: var(--app-text); font-weight: 600; }
    .nv-actions { display: flex; gap: 8px; margin-top: 14px; }
    .nv-main { flex: 1; min-height: 48px; border: none; border-radius: 999px; background: var(--app-cta, #e3e6bf); color: var(--app-on-accent, #161d18); font-weight: 600; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 6px; }
    .nv-main.pause { background: var(--app-bg-raised); color: var(--app-text); border: 1px solid var(--app-border-strong); }
    .nv-ghost { min-height: 48px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--app-border-strong); background: transparent; color: var(--app-text); display: flex; align-items: center; gap: 6px; font-weight: 600; }
    .nv-links { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
    .nv-links button, .nv-links a { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 14px; border: 1px solid var(--app-border); background: var(--app-card-bg); color: var(--app-text); font-size: 13.5px; text-decoration: none; text-align: left; }
    .nv-links ion-icon { font-size: 18px; color: var(--app-accent); }
    .nv-links .sos { color: #e8846b; }
    .nv-links .sos ion-icon { color: #e8846b; }
    .nv-note { display: flex; gap: 8px; margin: 14px 0 0; font-size: 12px; line-height: 1.5; color: var(--app-text-dim); }
    .nv-note ion-icon { flex-shrink: 0; margin-top: 2px; color: var(--app-accent); }
  `],
})
export class TrailNavigationPage implements OnDestroy {
  @ViewChild('mapHost') set mapHost(el: ElementRef<HTMLDivElement> | undefined) {
    if (el && !this.map) setTimeout(() => this.buildMap(el.nativeElement), 50);
  }

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toastCtrl = inject(ToastController);
  private readonly subscriptions = inject(SubscriptionService);
  private readonly catalog = inject(CatalogService);
  private readonly trails = inject(TrailService);

  readonly trail = signal<Trail | undefined>(undefined);
  readonly unlocked = computed(() => this.subscriptions.has('trailNavigation'));

  readonly me = signal<Fix | null>(null);
  readonly gpsError = signal('');
  readonly tracking = signal(false);
  readonly startedAt = signal<number | null>(null);
  private pausedMs = 0;
  private pausedAt: number | null = null;
  readonly track = signal<[number, number][]>([]);
  readonly walkedKm = signal(0);
  private readonly heading = signal<number | null>(null);
  private readonly clock = signal(Date.now());

  private summit: { lat: number; lng: number } | undefined;
  private summitM: number | undefined;
  private routePts: [number, number][] | undefined;
  hasRoute = false;

  private map?: L.Map;
  private base?: L.TileLayer;
  private satellite = false;
  private meMarker?: L.CircleMarker;
  private accCircle?: L.Circle;
  private toSummitLine?: L.Polyline;
  private trackLine?: L.Polyline;
  private watchId: number | null = null;
  private tick?: ReturnType<typeof setInterval>;
  private readonly onOrientation = (e: DeviceOrientationEvent) => {
    const ios = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
    if (typeof ios === 'number') this.heading.set(ios);
    else if (e.absolute && typeof e.alpha === 'number') this.heading.set((360 - e.alpha) % 360);
  };

  readonly toSummitKm = computed(() => {
    const m = this.me();
    return m && this.summit ? distanceKm(m.lat, m.lng, this.summit.lat, this.summit.lng) : null;
  });
  private readonly bearing = computed(() => {
    const m = this.me();
    return m && this.summit ? bearingDeg(m.lat, m.lng, this.summit.lat, this.summit.lng) : null;
  });
  readonly directionText = computed(() => {
    const b = this.bearing();
    return b === null ? '—' : `${COMPASS[Math.round(b / 45) % 8]} ${Math.round(b)}°`;
  });
  /** Arrow points at the summit; turns with the phone when it has a compass. */
  readonly arrowDeg = computed(() => {
    const b = this.bearing() ?? 0;
    const h = this.heading();
    return (h === null ? b : b - h) - 45; // the icon itself points north-east
  });
  readonly climbLeft = computed(() => {
    const alt = this.me()?.altitude;
    if (!this.summitM) return '—';
    if (alt === null || alt === undefined) return `${this.summitM.toLocaleString()} m summit`;
    return `${Math.max(0, Math.round(this.summitM - alt)).toLocaleString()} m`;
  });
  readonly elapsed = computed(() => {
    this.clock();
    const start = this.startedAt();
    if (!start) return '0:00';
    const end = this.pausedAt ?? Date.now();
    const secs = Math.max(0, Math.floor((end - start - this.pausedMs) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(secs % 60).padStart(2, '0')}`;
  });
  /** Metres from the recorded route, when off it. */
  readonly offRoute = computed(() => {
    const m = this.me();
    if (!m || !this.routePts?.length) return 0;
    const nearest = Math.min(...this.routePts.map(([la, ln]) => distanceKm(m.lat, m.lng, la, ln)));
    return nearest > OFF_ROUTE_KM ? nearest * 1000 : 0;
  });

  constructor() {
    addIcons({
      arrowBackOutline, callOutline, carOutline, flagOutline, layersOutline, locateOutline,
      navigateOutline, pauseOutline, playOutline, shareSocialOutline, stopOutline, warningOutline,
    });
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    const t = findTrail(id, this.catalog, this.trails);
    this.trail.set(t);
    if (t) {
      this.summit = geoFor(t.id, t);
      this.summitM = parseMetres(t.elevation);
      this.routePts = pathFor(t.id);
      this.hasRoute = !!this.routePts?.length;
    }
    void this.subscriptions.ready.then(() => {
      if (this.unlocked()) this.watchGps();
    });
    this.tick = setInterval(() => this.clock.set(Date.now()), 1000);
  }

  ngOnDestroy() {
    if (this.watchId !== null) navigator.geolocation?.clearWatch(this.watchId);
    window.removeEventListener('deviceorientation', this.onOrientation);
    clearInterval(this.tick);
    this.map?.remove();
  }

  goBack() {
    if (window.history.length > 1) this.location.back();
    else void this.router.navigate(['/tabs/home']);
  }

  // ── map ─────────────────────────────────────────────────────────────────

  private buildMap(host: HTMLDivElement) {
    if (this.map) return;
    const center: L.LatLngExpression = this.summit ? [this.summit.lat, this.summit.lng] : [14.6, 121];
    this.map = L.map(host, { zoomControl: false, attributionControl: true }).setView(center, 14);
    this.base = L.tileLayer(TOPO_URL, { attribution: ESRI, maxZoom: 18 }).addTo(this.map);

    if (this.summit) {
      L.marker([this.summit.lat, this.summit.lng], {
        icon: L.divIcon({ className: 'nv-summit', html: '<div style="font-size:22px;line-height:1">⛰️</div>', iconSize: [26, 26], iconAnchor: [13, 22] }),
      }).addTo(this.map).bindTooltip('Summit');
    }
    if (this.routePts?.length) {
      L.polyline(this.routePts, { color: '#e8d99c', weight: 5, opacity: 0.9 }).addTo(this.map);
    }
    this.trackLine = L.polyline([], { color: '#5fd97a', weight: 4 }).addTo(this.map);
    setTimeout(() => this.map?.invalidateSize(), 300);
    const m = this.me();
    if (m) this.drawMe(m);
  }

  toggleLayer() {
    if (!this.map) return;
    this.satellite = !this.satellite;
    this.base?.remove();
    this.base = L.tileLayer(this.satellite ? SAT_URL : TOPO_URL, { attribution: ESRI, maxZoom: 18 }).addTo(this.map);
  }

  centerOnMe() {
    const m = this.me();
    if (m && this.map) this.map.setView([m.lat, m.lng], 16);
    else void this.toast('Still waiting for your GPS position.');
  }

  private drawMe(m: Fix) {
    if (!this.map) return;
    const ll: L.LatLngExpression = [m.lat, m.lng];
    if (!this.meMarker) {
      this.accCircle = L.circle(ll, { radius: m.accuracy, color: '#4aa3ff', weight: 1, fillOpacity: 0.12 }).addTo(this.map);
      this.meMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#4aa3ff', fillOpacity: 1 }).addTo(this.map);
      if (this.summit) {
        this.map.fitBounds(L.latLngBounds([ll, [this.summit.lat, this.summit.lng]]).pad(0.25), { maxZoom: 16 });
      }
    } else {
      this.meMarker.setLatLng(ll);
      this.accCircle?.setLatLng(ll).setRadius(m.accuracy);
    }
    if (this.summit) {
      const pts: L.LatLngExpression[] = [ll, [this.summit.lat, this.summit.lng]];
      if (this.toSummitLine) this.toSummitLine.setLatLngs(pts);
      else this.toSummitLine = L.polyline(pts, { color: '#e8d99c', weight: 2, dashArray: '6 8' }).addTo(this.map);
    }
  }

  // ── GPS ─────────────────────────────────────────────────────────────────

  private watchGps() {
    if (!navigator.geolocation) {
      this.gpsError.set('This device has no GPS / location service.');
      return;
    }
    window.addEventListener('deviceorientation', this.onOrientation);
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.onFix({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        altitude: p.coords.altitude,
        at: p.timestamp,
      }),
      (err) => this.gpsError.set(
        err.code === err.PERMISSION_DENIED
          ? 'Location is blocked. Allow location for TrailBound in your settings to navigate.'
          : 'Could not get a GPS fix yet. Move to open sky and wait a moment.',
      ),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  private onFix(fix: Fix) {
    this.gpsError.set('');
    const prev = this.me();
    this.me.set(fix);
    this.drawMe(fix);
    if (!this.tracking() || fix.accuracy > 100) return;

    const pts = this.track();
    const last = pts[pts.length - 1];
    const step = last ? distanceKm(last[0], last[1], fix.lat, fix.lng) : 0;
    // Ignore GPS jitter under 8 m.
    if (!last || step > 0.008) {
      this.track.set([...pts, [fix.lat, fix.lng]]);
      this.trackLine?.setLatLngs(this.track());
      if (last && prev) this.walkedKm.update((km) => km + step);
    }
  }

  // ── tracking ────────────────────────────────────────────────────────────

  startTracking() {
    if (!this.startedAt()) this.startedAt.set(Date.now());
    if (this.pausedAt) {
      this.pausedMs += Date.now() - this.pausedAt;
      this.pausedAt = null;
    }
    this.tracking.set(true);
    const m = this.me();
    if (m && !this.track().length) {
      this.track.set([[m.lat, m.lng]]);
      this.trackLine?.setLatLngs(this.track());
    }
  }

  pauseTracking() {
    this.tracking.set(false);
    this.pausedAt = Date.now();
  }

  finish() {
    const summary = `Hike finished: ${this.walkedKm().toFixed(2)} km in ${this.elapsed()}.`;
    this.tracking.set(false);
    this.pausedAt = Date.now();
    void this.toast(summary);
  }

  // ── links ───────────────────────────────────────────────────────────────

  directions() {
    if (!this.summit) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${this.summit.lat},${this.summit.lng}`;
    window.open(url, '_blank');
  }

  async shareLocation() {
    const m = this.me();
    if (!m) {
      void this.toast('Still waiting for your GPS position.');
      return;
    }
    const url = `https://maps.google.com/?q=${m.lat.toFixed(6)},${m.lng.toFixed(6)}`;
    const text = `I'm hiking ${this.trail()?.name ?? ''}. My location: ${url}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (nav.share) await nav.share({ title: 'My location', text });
      else {
        await navigator.clipboard.writeText(text);
        void this.toast('Location link copied. Paste it in a message.');
      }
    } catch {
      // Share sheet closed — nothing to do.
    }
  }

  private async toast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'top', color: 'dark' });
    await t.present();
  }
}
