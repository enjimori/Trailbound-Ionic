import { Component, Input, booleanAttribute, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  sunnyOutline, partlySunnyOutline, cloudyOutline, rainyOutline,
  thunderstormOutline, snowOutline, waterOutline, flagOutline, timeOutline,
  checkmarkCircleOutline, refreshOutline, alertCircleOutline, umbrellaOutline,
  thermometerOutline, speedometerOutline, chevronDownOutline,
} from 'ionicons/icons';

import { TRAILS_30 } from './explore-trails.data';
import {
  ForecastRequest, TrailWeatherService,
} from './trail-weather.service';

addIcons({
  sunnyOutline, partlySunnyOutline, cloudyOutline, rainyOutline,
  thunderstormOutline, snowOutline, waterOutline, flagOutline, timeOutline,
  checkmarkCircleOutline, refreshOutline, alertCircleOutline, umbrellaOutline,
  thermometerOutline, speedometerOutline, chevronDownOutline,
});

/**
 * Pulls a number out of the dataset's display strings: "2,926 m" -> 2926.
 * Returns undefined rather than 0 when it cannot, because 0 would be sea level
 * and would quietly give every mountain the wrong forecast.
 */
function parseElevation(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const n = Number(String(text).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TRAIL WEATHER CARD
 *
 * One component, two shapes:
 *
 *   <app-trail-weather [trailId]="t.id" compact></app-trail-weather>
 *       A single row plus the most serious alert. For the Explore sheet,
 *       which is already tall.
 *
 *   <app-trail-weather [trailId]="t.id"></app-trail-weather>
 *       Current conditions, the next 12 hours, a 5-day outlook and every
 *       alert. For the detail page, where the decision gets made.
 *
 * Coordinates and summit elevation come from explore-trails.data.ts, so a
 * trail that is not in that dataset says so rather than showing a forecast
 * for the wrong place.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Component({
  selector: 'app-trail-weather',
  standalone: true,
  imports: [CommonModule, IonIcon],
  template: `
    <!-- No coordinates on file: say so, never guess. -->
    <div class="tw tw--flat" *ngIf="!request()">
      <ion-icon name="alert-circle-outline"></ion-icon>
      <span>No coordinates on file for this trail, so no forecast yet.</span>
    </div>

    <ng-container *ngIf="request() as req">
      <div class="tw" [ngClass]="'tw--' + level()">

        <!-- ── Summary row ───────────────────────────────────────────── -->
        <div class="tw-head" (click)="toggle()">
          <ion-icon class="tw-glyph" [name]="data()?.icon || 'cloudy-outline'"></ion-icon>

          <div class="tw-now" *ngIf="data() as d; else pending">
            <span class="tw-temp">{{ d.tempC }}&deg;C</span>
            <span class="tw-sum">
              {{ d.summary }}<ng-container *ngIf="d.feelsLikeC !== d.tempC">
                · feels {{ d.feelsLikeC }}&deg;</ng-container>
            </span>
          </div>

          <ng-template #pending>
            <div class="tw-now">
              <span class="tw-temp">{{ state().status === 'error' ? '—' : '…' }}</span>
              <span class="tw-sum">
                {{ state().status === 'error'
                    ? 'Forecast unavailable'
                    : 'Fetching summit forecast' }}
              </span>
            </div>
          </ng-template>

          <span class="tw-rain" *ngIf="data() as d">
            <ion-icon name="umbrella-outline"></ion-icon>
            {{ d.days.length ? d.days[0].rainChance : 0 }}%
          </span>

          <button
            class="tw-refresh"
            (click)="refresh($event, req)"
            [class.spin]="state().status === 'loading'"
            aria-label="Refresh forecast"
          >
            <ion-icon name="refresh-outline"></ion-icon>
          </button>
        </div>

        <!-- ── Alerts ────────────────────────────────────────────────── -->
        <div class="tw-alerts" *ngIf="data() as d">
          <div
            class="tw-alert"
            *ngFor="let a of visibleAlerts()"
            [ngClass]="'is-' + a.level"
          >
            <ion-icon [name]="a.icon"></ion-icon>
            <div>
              <strong>{{ a.title }}</strong>
              <p *ngIf="!compact || expanded()">{{ a.detail }}</p>
            </div>
          </div>

          <button
            class="tw-more"
            *ngIf="compact && d.alerts.length > 1 && !expanded()"
            (click)="toggle()"
          >
            {{ d.alerts.length - 1 }} more
            <ion-icon name="chevron-down-outline"></ion-icon>
          </button>
        </div>

        <!-- ── Detail (full card, or compact once expanded) ──────────── -->
        <ng-container *ngIf="data() as d">
          <ng-container *ngIf="!compact || expanded()">

            <div class="tw-metrics">
              <div>
                <ion-icon name="water-outline"></ion-icon>
                <span class="v">{{ d.rainMmPerHour | number:'1.0-1' }} mm/h</span>
                <span class="l">{{ d.rainIntensity === 'None' ? 'No rain' : d.rainIntensity }}</span>
              </div>
              <div>
                <ion-icon name="speedometer-outline"></ion-icon>
                <span class="v">{{ d.gustKph }} km/h</span>
                <span class="l">Gusts</span>
              </div>
              <div>
                <ion-icon name="thermometer-outline"></ion-icon>
                <span class="v">{{ d.humidity }}%</span>
                <span class="l">Humidity</span>
              </div>
            </div>

            <!-- Next 12 hours -->
            <p class="tw-label" *ngIf="d.hourly.length">Next 12 hours</p>
            <div class="tw-hours" *ngIf="d.hourly.length">
              <div class="tw-hour" *ngFor="let h of d.hourly">
                <span class="t">{{ h.label }}</span>
                <ion-icon [name]="h.icon"></ion-icon>
                <span class="d">{{ h.tempC }}&deg;</span>
                <span class="r" [class.wet]="h.rainChance >= 50">{{ h.rainChance }}%</span>
              </div>
            </div>

            <!-- 5-day outlook -->
            <p class="tw-label" *ngIf="d.days.length">5-day outlook</p>
            <div class="tw-day" *ngFor="let day of d.days">
              <span class="n">{{ day.label }}</span>
              <ion-icon [name]="day.icon"></ion-icon>
              <span class="s">{{ day.summary }}</span>
              <span class="rain" [class.wet]="day.rainMm >= 10">
                {{ day.rainMm }} mm · {{ day.rainChance }}%
              </span>
              <span class="temps">{{ day.tempMaxC }}&deg; / {{ day.tempMinC }}&deg;</span>
            </div>

            <p class="tw-foot">
              {{ svc.freshness(d) }} · model forecast downscaled to
              {{ d.modelElevationM }} m · Open-Meteo.
              Mountain weather turns faster than any model — check again on the
              morning you climb.
            </p>
          </ng-container>
        </ng-container>

        <p class="tw-foot compact-foot" *ngIf="compact && !expanded() && data()">
          {{ svc.freshness(data()) }} · tap for detail
        </p>

        <p class="tw-foot" *ngIf="state().status === 'error' && !data()">
          {{ state().error }} Check your connection and tap refresh.
        </p>
      </div>
    </ng-container>
  `,
  styles: [`
    :host {
      display: block;
      --tw-green: var(--app-green, #5b9a63);
      --tw-text: var(--app-text, #f2f5f2);
      --tw-dim: var(--app-text-dim, #9aa89c);
      --tw-card: var(--app-card-bg, #1b231c);
      --tw-border: var(--app-border, rgba(255, 255, 255, 0.09));
    }

    .tw {
      border-radius: 16px;
      background: var(--tw-card);
      border: 1px solid var(--tw-border);
      padding: 12px 14px;
      margin-bottom: 14px;
    }

    /* The left edge carries the worst alert level, so severity is readable
       before a single word is. */
    .tw--caution { border-left: 3px solid #e0b64a; }
    .tw--danger  { border-left: 3px solid #e26a6a; }

    .tw--flat {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--tw-dim);

      ion-icon { font-size: 16px; flex-shrink: 0; }
    }

    .tw-head {
      display: flex;
      align-items: center;
      gap: 11px;
    }

    .tw-glyph {
      font-size: 27px;
      color: var(--tw-green);
      flex-shrink: 0;
    }

    .tw-now {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }

    .tw-temp {
      font-size: 19px;
      font-weight: 800;
      color: var(--tw-text);
      line-height: 1.1;
    }

    .tw-sum {
      font-size: 11.5px;
      color: var(--tw-dim);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tw-rain {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      font-size: 12.5px;
      font-weight: 700;
      color: var(--tw-text);

      ion-icon { font-size: 14px; color: var(--tw-dim); }
    }

    .tw-refresh {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: var(--tw-dim);

      ion-icon { font-size: 16px; }

      &.spin ion-icon { animation: tw-spin 0.9s linear infinite; }
    }

    @keyframes tw-spin { to { transform: rotate(360deg); } }

    .tw-alerts { margin-top: 11px; }

    .tw-alert {
      display: flex;
      gap: 9px;
      padding: 9px 10px;
      border-radius: 11px;
      margin-bottom: 7px;
      font-size: 11.5px;
      line-height: 1.45;

      ion-icon { font-size: 15px; flex-shrink: 0; margin-top: 1px; }
      strong { display: block; font-size: 12px; font-weight: 700; }
      p { margin: 3px 0 0; opacity: 0.88; }

      &.is-info {
        background: rgba(255, 255, 255, 0.045);
        color: var(--tw-dim);
        strong { color: var(--tw-text); }
      }
      &.is-caution {
        background: rgba(224, 182, 74, 0.13);
        border: 1px solid rgba(224, 182, 74, 0.26);
        color: #e8cc8e;
      }
      &.is-danger {
        background: rgba(226, 106, 106, 0.14);
        border: 1px solid rgba(226, 106, 106, 0.3);
        color: #f0a3a3;
      }
    }

    .tw-more {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 0;
      border: none;
      background: none;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--tw-green);

      ion-icon { font-size: 13px; }
    }

    .tw-metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin: 12px 0 4px;

      > div {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 9px 4px;
        border-radius: 11px;
        background: rgba(255, 255, 255, 0.04);
      }

      ion-icon { font-size: 15px; color: var(--tw-green); }
      .v { font-size: 12px; font-weight: 700; color: var(--tw-text); }
      .l { font-size: 9.5px; color: var(--tw-dim); }
    }

    .tw-label {
      margin: 14px 0 7px;
      font-size: 9.5px;
      font-weight: 800;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--tw-dim);
    }

    .tw-hours {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      margin: 0 -14px;
      padding: 0 14px 4px;
      scrollbar-width: none;

      &::-webkit-scrollbar { display: none; }
    }

    .tw-hour {
      flex: 0 0 auto;
      width: 52px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      padding: 8px 0;
      border-radius: 11px;
      background: rgba(255, 255, 255, 0.04);

      .t { font-size: 9.5px; color: var(--tw-dim); }
      ion-icon { font-size: 15px; color: var(--tw-green); }
      .d { font-size: 12px; font-weight: 700; color: var(--tw-text); }
      .r { font-size: 9.5px; color: var(--tw-dim); }
      .r.wet { color: #7fb6e8; font-weight: 700; }
    }

    .tw-day {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 0;
      border-bottom: 1px solid var(--tw-border);
      font-size: 11.5px;

      &:last-of-type { border-bottom: none; }

      .n {
        width: 42px;
        flex-shrink: 0;
        font-weight: 700;
        color: var(--tw-text);
      }

      ion-icon { font-size: 15px; color: var(--tw-green); flex-shrink: 0; }

      .s {
        flex: 1;
        min-width: 0;
        color: var(--tw-dim);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .rain {
        flex-shrink: 0;
        color: var(--tw-dim);
        &.wet { color: #7fb6e8; font-weight: 700; }
      }

      .temps {
        width: 62px;
        flex-shrink: 0;
        text-align: right;
        font-weight: 700;
        color: var(--tw-text);
      }
    }

    .tw-foot {
      margin: 12px 0 0;
      font-size: 10px;
      line-height: 1.5;
      color: var(--tw-dim);
      opacity: 0.8;
    }

    .compact-foot { margin-top: 8px; }
  `],
})
export class TrailWeatherComponent {
  private readonly id = signal<string>('');

  @Input({ required: true }) set trailId(value: string) {
    this.id.set(value ?? '');
    this.expanded.set(false);
    const req = this.request();
    if (req) this.svc.load(req);
  }

  /** Single row plus the worst alert. For the Explore sheet. */
  @Input({ transform: booleanAttribute }) compact = false;

  expanded = signal(false);

  /**
   * Coordinates, summit elevation and trail type, read from the Explore
   * dataset. Null for any id that is not in it — the seeded t1–t6 trails have
   * no coordinates, and a forecast for the wrong mountain is worse than none.
   */
  request = computed<ForecastRequest | null>(() => {
    const t = TRAILS_30.find(x => x.id === this.id());
    if (!t) return null;
    return {
      id: t.id,
      lat: t.lat,
      lng: t.lng,
      elevationM: parseElevation(t.elevation),
      trailType: t.trailType,
    };
  });

  state = computed(() => this.svc.stateFor(this.id()));
  data = computed(() => this.state().data);
  level = computed(() => this.svc.worstLevel(this.data()));

  /** Compact shows the single most serious alert until it is expanded. */
  visibleAlerts = computed(() => {
    const all = this.data()?.alerts ?? [];
    return this.compact && !this.expanded() ? all.slice(0, 1) : all;
  });

  constructor(public svc: TrailWeatherService) {}

  toggle() {
    if (this.compact) this.expanded.update(v => !v);
  }

  refresh(ev: Event, req: ForecastRequest) {
    ev.stopPropagation();
    this.svc.load(req, true);
  }
}
