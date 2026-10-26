/**
 * TrailBound Pro — real-time weather monitoring.
 *
 *   <app-weather-monitor [trail]="t"></app-weather-monitor>
 *
 * While the page is open it re-checks the summit every 5 minutes (the same
 * Open-Meteo forecast the summit weather card uses, so both stay in step) and
 * lists what changed: rain starting or stopping, temperature swings, strong
 * gusts, new weather alerts. A dangerous change also pops up a message.
 *
 * The summit weather card above it stays free for everyone — it is safety
 * information. Without Pro this shows a one-line lock instead.
 */
import {
  Component, Input, OnDestroy, OnInit, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { pulseOutline, refreshOutline, warningOutline } from 'ionicons/icons';

import { Trail } from '../models/trail.model';
import { SubscriptionService } from '../services/subscription.service';
import { TrailForecast, TrailWeatherService } from '../pages/explore/trail-weather.service';
import { LockedFeatureComponent } from './locked-feature.component';
import { weatherRequestFor } from './premium';

/** How often the summit is re-checked while the page is open. */
const CHECK_EVERY_MS = 5 * 60 * 1000;

interface Change { at: number; text: string; danger: boolean; }

@Component({
  selector: 'app-weather-monitor',
  standalone: true,
  imports: [CommonModule, IonIcon, LockedFeatureComponent],
  template: `
    <app-locked-feature *ngIf="!unlocked(); else live" compact
      feature="liveWeather" title="Real-time weather monitoring"></app-locked-feature>

    <ng-template #live>
      <section class="wm" *ngIf="request(); else noCoords">
        <div class="wm-head">
          <span class="wm-live"><span class="dot"></span>LIVE</span>
          <span class="wm-title">Weather monitoring</span>
          <button type="button" class="wm-refresh" (click)="checkNow()" aria-label="Check now"
            [class.spin]="state().status === 'loading'">
            <ion-icon name="refresh-outline"></ion-icon>
          </button>
        </div>

        <div class="wm-now" *ngIf="data() as d">
          <span class="t">{{ d.tempC }}&deg;C</span>
          <span class="s">{{ d.summary }} · gusts {{ d.gustKph }} km/h · rain {{ d.rainMmPerHour | number: '1.0-1' }} mm/h</span>
        </div>

        <p class="wm-meta">
          Checked {{ lastChecked() ? (lastChecked() | date: 'h:mm a') : '…' }}
          · next check in {{ nextInMin() }} min · every 5 minutes while this page is open
        </p>

        <ul class="wm-changes" *ngIf="changes().length; else steady">
          <li *ngFor="let c of changes()" [class.danger]="c.danger">
            <ion-icon [name]="c.danger ? 'warning-outline' : 'pulse-outline'"></ion-icon>
            <span>{{ c.text }}</span>
            <time>{{ c.at | date: 'h:mm a' }}</time>
          </li>
        </ul>
        <ng-template #steady>
          <p class="wm-steady">No changes since you opened this page.</p>
        </ng-template>
      </section>
      <ng-template #noCoords></ng-template>
    </ng-template>
  `,
  styles: [`
    :host { display: block; margin: 10px 0 4px; }
    .wm {
      padding: 12px 14px;
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius, 16px);
      background: var(--app-card-bg);
    }
    .wm-head { display: flex; align-items: center; gap: 8px; }
    .wm-live {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 2px 8px; border-radius: 999px;
      background: rgba(95, 217, 122, 0.14); color: #5fd97a;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em;
    }
    .wm-live .dot {
      width: 7px; height: 7px; border-radius: 50%; background: #5fd97a;
      animation: wm-pulse 1.6s ease-in-out infinite;
    }
    @keyframes wm-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
    .wm-title { flex: 1; font-size: 13.5px; font-weight: 600; color: var(--app-text); }
    .wm-refresh {
      width: 32px; height: 32px; border: none; border-radius: 10px;
      background: var(--app-bg-raised); color: var(--app-text-dim);
      display: grid; place-items: center;
    }
    .wm-refresh.spin ion-icon { animation: wm-spin 0.9s linear infinite; }
    @keyframes wm-spin { to { transform: rotate(360deg); } }
    .wm-now { display: flex; align-items: baseline; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .wm-now .t { font-size: 20px; color: var(--app-text); font-family: var(--app-font-serif); }
    .wm-now .s { font-size: 12.5px; color: var(--app-text-dim); }
    .wm-meta { margin: 6px 0 0; font-size: 11.5px; color: var(--app-text-dim); line-height: 1.45; }
    .wm-steady { margin: 10px 0 0; font-size: 12.5px; color: var(--app-text-dim); }
    .wm-changes { list-style: none; margin: 10px 0 0; padding: 0; }
    .wm-changes li {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 7px 0; border-top: 1px solid var(--app-border);
      font-size: 12.5px; color: var(--app-text);
    }
    .wm-changes li ion-icon { color: var(--app-accent); font-size: 15px; flex-shrink: 0; margin-top: 1px; }
    .wm-changes li.danger ion-icon, .wm-changes li.danger span { color: #e8846b; }
    .wm-changes li span { flex: 1; }
    .wm-changes time { font-size: 11px; color: var(--app-text-dim); }
  `],
})
export class WeatherMonitorComponent implements OnInit, OnDestroy {
  @Input({ required: true }) set trail(value: Trail | undefined) { this.trailSig.set(value); }

  private readonly subscriptions = inject(SubscriptionService);
  private readonly svc = inject(TrailWeatherService);
  private readonly toastCtrl = inject(ToastController);

  private readonly trailSig = signal<Trail | undefined>(undefined);
  readonly unlocked = computed(() => this.subscriptions.has('liveWeather'));
  readonly request = computed(() => weatherRequestFor(this.trailSig()));
  readonly state = computed(() => this.svc.stateFor(this.trailSig()?.id ?? ''));
  readonly data = computed(() => this.state().data);
  readonly lastChecked = computed(() => this.data()?.fetchedAt ?? 0);

  readonly changes = signal<Change[]>([]);
  private readonly now = signal(Date.now());
  readonly nextInMin = computed(() => {
    const due = (this.lastChecked() || this.now()) + this.everyMs();
    return Math.max(0, Math.ceil((due - this.now()) / 60000));
  });

  private previous: TrailForecast | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private ticker?: ReturnType<typeof setInterval>;

  constructor() {
    addIcons({ pulseOutline, refreshOutline, warningOutline });

    // Compare every new reading with the one before it.
    effect(() => {
      const d = this.data();
      if (!d || !this.unlocked()) return;
      untracked(() => this.compare(d));
    });

    // Start or stop checking when the plan or trail changes.
    effect(() => {
      const on = this.unlocked() && !!this.request();
      untracked(() => (on ? this.start() : this.stop()));
    });
  }

  ngOnInit() {
    this.ticker = setInterval(() => this.now.set(Date.now()), 20_000);
  }

  ngOnDestroy() {
    this.stop();
    clearInterval(this.ticker);
  }

  checkNow() {
    const req = this.request();
    if (req) this.svc.load(req, true);
  }

  private everyMs(): number {
    // Tests can shorten the interval: window.__liveWeatherMs = 3000
    const override = Number((window as unknown as { __liveWeatherMs?: number }).__liveWeatherMs);
    return override > 0 ? override : CHECK_EVERY_MS;
  }

  private start() {
    if (this.timer) return;
    this.checkNow();
    this.timer = setInterval(() => this.checkNow(), this.everyMs());
  }

  private stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private compare(d: TrailForecast) {
    const before = this.previous;
    if (before && before.fetchedAt === d.fetchedAt) return;
    this.previous = d;
    if (!before) return;

    const found: Change[] = [];
    const at = d.fetchedAt;
    const raining = (f: TrailForecast) => f.rainMmPerHour > 0;

    if (!raining(before) && raining(d)) found.push({ at, text: `Rain started (${d.rainIntensity.toLowerCase()})`, danger: d.rainIntensity === 'Heavy' });
    if (raining(before) && !raining(d)) found.push({ at, text: 'Rain stopped', danger: false });
    if (Math.abs(d.tempC - before.tempC) >= 2) {
      found.push({ at, text: `Temperature ${d.tempC > before.tempC ? 'up' : 'down'} to ${d.tempC}°C (was ${before.tempC}°C)`, danger: false });
    }
    if (d.gustKph >= 40 && before.gustKph < 40) found.push({ at, text: `Strong gusts: ${d.gustKph} km/h`, danger: d.gustKph >= 60 });
    if (d.summary !== before.summary && !found.length) found.push({ at, text: `Now ${d.summary.toLowerCase()}`, danger: false });

    const oldTitles = new Set(before.alerts.map((a) => a.title));
    for (const a of d.alerts) {
      if (!oldTitles.has(a.title)) found.push({ at, text: `New alert: ${a.title}`, danger: a.level === 'danger' });
    }

    if (!found.length) return;
    this.changes.update((list) => [...found, ...list].slice(0, 8));
    const urgent = found.find((c) => c.danger);
    if (urgent) void this.toast(`Weather alert: ${urgent.text}`);
  }

  private async toast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 3500, position: 'top', color: 'warning' });
    await t.present();
  }
}
