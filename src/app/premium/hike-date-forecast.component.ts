/**
 * TrailBound Basic — weather forecast for your booked hike date.
 *
 *   <app-hike-date-forecast [trailId]="b.trailId" [date]="b.date"></app-hike-date-forecast>
 *
 * Shown on each upcoming booking in the Bookings tab. Asks Open-Meteo for the
 * summit's forecast on that one day. Forecasts reach 16 days ahead, so a hike
 * further out says when its forecast will appear instead of guessing.
 * Without a plan: a one-line lock.
 */
import { Component, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  calendarOutline, cloudyOutline, partlySunnyOutline, rainyOutline, sunnyOutline,
  thunderstormOutline, umbrellaOutline,
} from 'ionicons/icons';

import { SubscriptionService } from '../services/subscription.service';
import { CatalogService } from '../services/catalog.service';
import { TrailService } from '../services/trail.service';
import { LockedFeatureComponent } from './locked-feature.component';
import { daysUntil, describeWeatherCode, findTrail, weatherRequestFor } from './premium';

const API = 'https://api.open-meteo.com/v1/forecast';
/** Open-Meteo's furthest daily forecast. */
const MAX_DAYS_AHEAD = 15;
const TTL_MS = 30 * 60 * 1000;

export interface HikeDayForecast {
  summary: string;
  icon: string;
  maxC: number;
  minC: number;
  rainChance: number;
  rainMm: number;
  gustKph: number;
  verdict: string;
  level: 'good' | 'caution' | 'danger';
}

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; f: HikeDayForecast }
  | { kind: 'later'; daysLeft: number }
  | { kind: 'none'; text: string };

/** Shared across cards so scrolling the list does not refetch. */
const cache = new Map<string, { at: number; f: HikeDayForecast }>();

function verdictFor(code: number, rainChance: number, gust: number): Pick<HikeDayForecast, 'verdict' | 'level'> {
  if (code >= 95) return { level: 'danger', verdict: 'Thunderstorms likely — talk to your guide about rescheduling.' };
  if (gust >= 60) return { level: 'danger', verdict: 'Very strong winds on the summit — check with your guide.' };
  if (rainChance >= 60) return { level: 'caution', verdict: 'Rain likely — pack a rain jacket and dry bags.' };
  if (gust >= 40) return { level: 'caution', verdict: 'Windy at the top — bring a windbreaker.' };
  return { level: 'good', verdict: 'Looks like good hiking weather.' };
}

@Component({
  selector: 'app-hike-date-forecast',
  standalone: true,
  imports: [CommonModule, IonIcon, LockedFeatureComponent],
  template: `
    <app-locked-feature *ngIf="!unlocked(); else open" compact
      feature="hikeDateForecast" title="Weather for your hike date"></app-locked-feature>

    <ng-template #open>
      <div class="hf" [attr.data-level]="level()">
        <ng-container [ngSwitch]="view().kind">
          <ng-container *ngSwitchCase="'ready'">
            <ion-icon class="hf-icon" [name]="forecast()!.icon"></ion-icon>
            <div class="hf-text">
              <span class="hf-line"><b>{{ forecast()!.summary }}</b> · {{ forecast()!.maxC }}&deg; / {{ forecast()!.minC }}&deg;
                · <ion-icon name="umbrella-outline"></ion-icon>{{ forecast()!.rainChance }}%</span>
              <span class="hf-verdict">{{ forecast()!.verdict }}</span>
            </div>
          </ng-container>
          <ng-container *ngSwitchCase="'later'">
            <ion-icon class="hf-icon" name="calendar-outline"></ion-icon>
            <span class="hf-line">Hike-day forecast appears in {{ laterDays() }} days, about two weeks before your hike.</span>
          </ng-container>
          <ng-container *ngSwitchCase="'loading'">
            <ion-icon class="hf-icon" name="partly-sunny-outline"></ion-icon>
            <span class="hf-line">Getting the forecast for your hike date…</span>
          </ng-container>
          <ng-container *ngSwitchDefault>
            <ion-icon class="hf-icon" name="cloudy-outline"></ion-icon>
            <span class="hf-line">{{ noneText() }}</span>
          </ng-container>
        </ng-container>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; margin-top: 10px; }
    .hf {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 12px; border-radius: 12px;
      background: var(--app-bg-raised); border: 1px solid var(--app-border);
    }
    .hf[data-level='caution'] { border-color: rgba(224, 177, 92, 0.5); }
    .hf[data-level='danger'] { border-color: rgba(232, 132, 107, 0.6); }
    .hf-icon { font-size: 22px; color: var(--app-accent); flex-shrink: 0; }
    .hf-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .hf-line { font-size: 12.5px; color: var(--app-text); }
    .hf-line b { font-weight: 600; }
    .hf-line ion-icon { font-size: 12px; vertical-align: -1px; margin-right: 2px; }
    .hf-verdict { font-size: 11.5px; color: var(--app-text-dim); }
    .hf[data-level='caution'] .hf-verdict { color: #e0b15c; }
    .hf[data-level='danger'] .hf-verdict { color: #e8846b; }
  `],
})
export class HikeDateForecastComponent implements OnChanges {
  @Input({ required: true }) trailId = '';
  /** "yyyy-mm-dd" */
  @Input({ required: true }) date = '';

  private readonly subscriptions = inject(SubscriptionService);
  private readonly catalog = inject(CatalogService);
  private readonly trails = inject(TrailService);

  readonly unlocked = computed(() => this.subscriptions.has('hikeDateForecast'));
  readonly view = signal<View>({ kind: 'loading' });
  readonly forecast = computed(() => { const v = this.view(); return v.kind === 'ready' ? v.f : null; });
  readonly level = computed(() => this.forecast()?.level ?? 'none');
  readonly laterDays = computed(() => { const v = this.view(); return v.kind === 'later' ? v.daysLeft : 0; });
  readonly noneText = computed(() => { const v = this.view(); return v.kind === 'none' ? v.text : ''; });

  constructor() {
    addIcons({
      calendarOutline, cloudyOutline, partlySunnyOutline, rainyOutline, sunnyOutline,
      thunderstormOutline, umbrellaOutline,
    });
  }

  ngOnChanges() {
    void this.subscriptions.ready.then(() => {
      if (this.unlocked()) void this.load();
    });
  }

  private async load() {
    const ahead = daysUntil(this.date);
    if (ahead < 0) { this.view.set({ kind: 'none', text: 'This hike date has passed.' }); return; }
    if (ahead > MAX_DAYS_AHEAD) { this.view.set({ kind: 'later', daysLeft: ahead - MAX_DAYS_AHEAD }); return; }

    const req = weatherRequestFor(findTrail(this.trailId, this.catalog, this.trails));
    if (!req) { this.view.set({ kind: 'none', text: 'No coordinates on file for this trail, so no forecast.' }); return; }

    const key = `${this.trailId}|${this.date}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) { this.view.set({ kind: 'ready', f: hit.f }); return; }

    this.view.set({ kind: 'loading' });
    try {
      const params = new URLSearchParams({
        latitude: String(req.lat),
        longitude: String(req.lng),
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max',
        timezone: 'Asia/Manila',
        start_date: this.date,
        end_date: this.date,
      });
      if (req.elevationM) params.set('elevation', String(req.elevationM));
      const res = await fetch(`${API}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()).daily ?? {};
      const code = Number(d.weather_code?.[0] ?? 0);
      const rainChance = Math.round(Number(d.precipitation_probability_max?.[0] ?? 0));
      const gust = Math.round(Number(d.wind_gusts_10m_max?.[0] ?? 0));
      const info = describeWeatherCode(code);
      const f: HikeDayForecast = {
        summary: info.summary,
        icon: info.icon,
        maxC: Math.round(Number(d.temperature_2m_max?.[0] ?? 0)),
        minC: Math.round(Number(d.temperature_2m_min?.[0] ?? 0)),
        rainChance,
        rainMm: Math.round(Number(d.precipitation_sum?.[0] ?? 0) * 10) / 10,
        gustKph: gust,
        ...verdictFor(code, rainChance, gust),
      };
      cache.set(key, { at: Date.now(), f });
      this.view.set({ kind: 'ready', f });
    } catch (e) {
      console.warn('[HikeDateForecast] forecast failed', e);
      this.view.set({ kind: 'none', text: 'Forecast unavailable right now. Check your connection.' });
    }
  }
}
