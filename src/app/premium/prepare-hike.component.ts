/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PREPARE FOR YOUR HIKE — the MLP section on every trail details page
 *
 *   <app-prepare-hike [trail]="t"></app-prepare-hike>
 *
 * Three parts:
 *   1. Difficulty level — what Easy / Moderate / Hard means for this trail.
 *   2. Gear checklist — picked for the trail's difficulty; subscribers can tick
 *      items off (saved on this device per trail).
 *   3. Simple first-aid tips.
 *
 * Who sees what:
 *   • Any TrailBound plan (Basic, Pro, Facilitator) → the full section.
 *   • Everyone else → the difficulty level and the first-aid tips (safety
 *     information stays free), plus a preview of the gear checklist with an
 *     "Unlock with TrailBound Basic" button.
 *   To lock the first-aid tips too, wrap that block in *ngIf="unlocked()".
 *
 * Smart checklist (TrailBound Pro / Facilitator): extra gear picked from the
 * summit forecast for the chosen hike day (rain, cold, heat, wind, storms)
 * and from the trip length (overnight and multi-day trips). Locked otherwise.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Component, Input, OnChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  bandageOutline, checkmark, chevronDownOutline, lockClosedOutline, medkitOutline,
  speedometerOutline, starOutline,
} from 'ionicons/icons';

import { Difficulty, Trail } from '../models/trail.model';
import { planById } from '../models/subscription.model';
import { SubscriptionService } from '../services/subscription.service';
import { DayForecast, TrailWeatherService } from '../pages/explore/trail-weather.service';
import { LockedFeatureComponent } from './locked-feature.component';
import { weatherRequestFor } from './premium';

export interface GearItem { id: string; text: string; why?: string; }

/** Pro: gear the forecast for the hike day calls for. */
function weatherGear(d: DayForecast): GearItem[] {
  const items: GearItem[] = [];
  const wet = d.rainChance >= 50 || d.rainMm >= 5;
  if (wet) {
    const why = `${d.rainChance}% chance of rain, ${d.rainMm} mm`;
    items.push(
      { id: 'w-cover', text: 'Waterproof pack cover or dry bags', why },
      { id: 'w-socks', text: 'Spare socks in a zip bag', why },
      { id: 'w-quickdry', text: 'Quick-dry clothes — no cotton', why },
    );
  }
  if (/thunder/i.test(d.summary)) {
    items.push({ id: 'w-storm', text: 'Plan to leave the summit by early afternoon', why: 'Thunderstorms forecast' });
  }
  if (d.tempMinC <= 14) {
    items.push({ id: 'w-cold', text: 'Thermal base layer, gloves and bonnet', why: `Summit low of ${d.tempMinC}°C` });
  }
  if (d.tempMaxC >= 30) {
    const why = `Summit high of ${d.tempMaxC}°C`;
    items.push(
      { id: 'w-water', text: 'An extra 1 L of water and electrolytes', why },
      { id: 'w-cool', text: 'Cooling towel or sun sleeves', why },
    );
  }
  if (d.gustKph >= 40) {
    items.push({ id: 'w-wind', text: 'Windbreaker, and tie down loose items', why: `Gusts up to ${d.gustKph} km/h` });
  }
  return items;
}

/** Pro: gear for nights on the mountain. */
function multiDayGear(nights: number, lowC: number | null): GearItem[] {
  if (nights < 1) return [];
  const days = nights + 1;
  const why = `${nights}-night trip`;
  return [
    { id: 'm-shelter', text: 'Tent, or a confirmed campsite / homestay', why },
    { id: 'm-bag', text: lowC !== null ? `Sleeping bag rated to about ${Math.max(0, lowC - 3)}°C` : 'Sleeping bag', why },
    { id: 'm-pad', text: 'Sleeping pad', why },
    { id: 'm-stove', text: 'Stove, fuel and cook set (or meals confirmed with your guide)', why },
    { id: 'm-meals', text: `Meals for ${days} days plus emergency food`, why },
    { id: 'm-filter', text: 'Water filter or purification tablets', why },
    { id: 'm-clothes', text: `Change of clothes × ${nights}`, why },
    { id: 'm-batt', text: 'Spare headlamp batteries', why },
    { id: 'm-toilet', text: 'Toiletries and a trowel — leave no trace', why },
  ];
}

const TRIP_LENGTHS = [
  { nights: 0, label: 'Day hike' },
  { nights: 1, label: '1 night' },
  { nights: 2, label: '2 nights' },
  { nights: 3, label: '3 nights' },
];

const DIFFICULTY_INFO: Record<Difficulty, { summary: string; fitness: string }> = {
  Easy: {
    summary: 'Gentle, well-marked trail with few steep parts.',
    fitness: 'Good for first-time hikers. Regular walking is enough preparation.',
  },
  Moderate: {
    summary: 'Some steep, rocky or muddy sections.',
    fitness: 'Best if you can walk 3–5 hours with short breaks. Some hiking experience helps.',
  },
  Hard: {
    summary: 'Long, steep or technical climb.',
    fitness: 'For experienced hikers in good shape. Train for a few weeks before you go.',
  },
};

/**
 * Water first, then the rest; harder trails add items on top.
 * Also used by the Facilitator's client checklist (/client-checklist).
 */
export function gearFor(difficulty: Difficulty): GearItem[] {
  const water: Record<Difficulty, string> = {
    Easy: 'Water — at least 1.5 L',
    Moderate: 'Water — at least 2 L',
    Hard: 'Water — at least 3 L',
  };
  const items: GearItem[] = [
    { id: 'water', text: water[difficulty] },
    { id: 'food', text: 'Trail snacks or a packed lunch' },
    { id: 'rain', text: 'Rain jacket or poncho' },
    { id: 'sun', text: 'Hat and sunscreen' },
    { id: 'firstaid', text: 'Small first-aid kit (plasters, bandage, any personal medicine)' },
    { id: 'id', text: 'Valid ID and your booking confirmation' },
    { id: 'phone', text: 'Phone and a charged power bank' },
    { id: 'trash', text: 'Trash bag — leave no trace' },
    { id: 'cash', text: 'Cash for local fees' },
  ];
  if (difficulty !== 'Easy') {
    items.push(
      { id: 'headlamp', text: 'Headlamp or flashlight' },
      { id: 'pole', text: 'Trekking pole' },
      { id: 'electrolytes', text: 'Electrolyte drink or tablets' },
      { id: 'layer', text: 'Extra shirt and a warm layer' },
    );
  }
  if (difficulty === 'Hard') {
    items.push(
      { id: 'cold', text: 'Warm jacket, gloves and bonnet for a cold summit' },
      { id: 'whistle', text: 'Emergency whistle and space blanket' },
      { id: 'extrafood', text: 'Extra food for a long day' },
    );
  }
  return items;
}

const FIRST_AID_TIPS: { title: string; text: string }[] = [
  {
    title: 'Blisters',
    text: 'Stop as soon as you feel rubbing. Clean the spot, cover it with a plaster or tape, and don’t pop it.',
  },
  {
    title: 'Sprained ankle',
    text: 'Stop and rest it. Wrap it firmly, raise it when you can, and use a cold compress. Let your guide decide how to get you down.',
  },
  {
    title: 'Cuts and scrapes',
    text: 'Rinse with clean water, press with a clean cloth until the bleeding stops, then cover with a bandage.',
  },
  {
    title: 'Heat exhaustion',
    text: 'Signs: heavy sweating, dizziness, headache or nausea. Move to shade, loosen clothing, sip water or an electrolyte drink, and cool the skin.',
  },
  {
    title: 'Cold and hypothermia',
    text: 'Common on high summits at dawn. Signs: strong shivering, slurred speech, clumsiness. Get out of the wind, change into dry layers, and have a warm drink.',
  },
];

const STORAGE_PREFIX = 'trailbound.prep.';

@Component({
  selector: 'app-prepare-hike',
  standalone: true,
  imports: [CommonModule, IonIcon, LockedFeatureComponent],
  template: `
    <section class="ph" *ngIf="trail">
      <div class="ph-head">
        <p class="ph-title">Prepare for Your Hike</p>
        <span class="ph-plan" *ngIf="unlocked(); else lockedTag">
          <ion-icon name="star-outline"></ion-icon> {{ planName() }}
        </span>
        <ng-template #lockedTag>
          <span class="ph-plan muted">TrailBound Basic</span>
        </ng-template>
      </div>

      <!-- 1. Difficulty level -->
      <div class="ph-card ph-diff">
        <span class="ph-icon"><ion-icon name="speedometer-outline"></ion-icon></span>
        <div class="ph-diff-text">
          <span class="ph-label">Difficulty level</span>
          <span class="diff-badge" [ngClass]="trail.difficulty.toLowerCase()">{{ trail.difficulty }}</span>
          <p>{{ difficulty().summary }} {{ difficulty().fitness }}</p>
        </div>
      </div>

      <!-- 2. Gear checklist -->
      <div class="ph-card">
        <div class="ph-card-head">
          <span class="ph-label">Gear checklist</span>
          <span class="ph-count" *ngIf="unlocked()">{{ packedCount() }} of {{ gear().length }} packed</span>
        </div>

        <ng-container *ngIf="unlocked(); else lockedGear">
          <div class="ph-progress" aria-hidden="true">
            <span [style.width.%]="gear().length ? (packedCount() / gear().length) * 100 : 0"></span>
          </div>
          <button
            type="button"
            class="ph-item"
            *ngFor="let g of gear()"
            [class.done]="isPacked(g.id)"
            [attr.aria-pressed]="isPacked(g.id)"
            (click)="togglePacked(g.id)"
          >
            <span class="ph-box"><ion-icon name="checkmark" *ngIf="isPacked(g.id)"></ion-icon></span>
            <span>{{ g.text }}</span>
          </button>
        </ng-container>

        <ng-template #lockedGear>
          <div class="ph-preview">
            <div class="ph-item preview" *ngFor="let g of gear().slice(0, 3)">
              <span class="ph-box"></span><span>{{ g.text }}</span>
            </div>
            <p class="ph-more">+ {{ gear().length - 3 }} more items picked for a {{ trail.difficulty }} trail</p>
          </div>
          <button type="button" class="ph-unlock" (click)="goPlans()">
            <ion-icon name="lock-closed-outline"></ion-icon>
            Unlock with TrailBound Basic · ₱{{ basicPrice }}/month
          </button>
        </ng-template>
      </div>

      <!-- Pro: smart checklist (live weather + multi-day) -->
      <div class="ph-card ph-smart" *ngIf="unlocked() && smartUnlocked()">
        <div class="ph-card-head">
          <span class="ph-label"><ion-icon name="star-outline"></ion-icon> Smart checklist</span>
          <span class="ph-count" *ngIf="smartGear().length">{{ smartPackedCount() }} of {{ smartGear().length }} packed</span>
        </div>

        <span class="ph-sub">Trip length</span>
        <div class="ph-chips">
          <button type="button" *ngFor="let l of tripLengths" [class.on]="nights() === l.nights" (click)="setNights(l.nights)">{{ l.label }}</button>
        </div>

        <ng-container *ngIf="forecastDays().length; else noForecast">
          <span class="ph-sub">Hike day</span>
          <div class="ph-chips">
            <button type="button" *ngFor="let d of forecastDays(); let i = index" [class.on]="dayIndex() === i" (click)="dayIndex.set(i)">{{ d.label }}</button>
          </div>
          <p class="ph-wx" *ngIf="hikeDay() as d">
            {{ d.summary }} · {{ d.tempMaxC }}&deg; / {{ d.tempMinC }}&deg; · {{ d.rainChance }}% rain · gusts {{ d.gustKph }} km/h
          </p>
        </ng-container>
        <ng-template #noForecast>
          <p class="ph-wx">{{ weatherNote() }}</p>
        </ng-template>

        <button
          type="button"
          class="ph-item"
          *ngFor="let g of smartGear()"
          [class.done]="isPacked(g.id)"
          [attr.aria-pressed]="isPacked(g.id)"
          (click)="togglePacked(g.id)"
        >
          <span class="ph-box"><ion-icon name="checkmark" *ngIf="isPacked(g.id)"></ion-icon></span>
          <span class="ph-smart-text">{{ g.text }}<small *ngIf="g.why">{{ g.why }}</small></span>
        </button>
        <p class="ph-more" *ngIf="!smartGear().length && hikeDay()">Settled weather for a day hike — the list above is enough.</p>
      </div>

      <app-locked-feature
        *ngIf="unlocked() && !smartUnlocked()"
        feature="smartPrepare"
        title="Smart checklist"
        text="Adds the gear the forecast calls for on your hike day — rain, cold, heat or wind — and everything for overnight and multi-day trips."
      ></app-locked-feature>

      <!-- 3. First-aid tips -->
      <div class="ph-card">
        <div class="ph-card-head">
          <span class="ph-label"><ion-icon name="medkit-outline"></ion-icon> Simple first-aid tips</span>
        </div>
        <details class="ph-tip" *ngFor="let tip of tips">
          <summary>
            <ion-icon name="bandage-outline"></ion-icon>
            <span>{{ tip.title }}</span>
            <ion-icon class="chev" name="chevron-down-outline"></ion-icon>
          </summary>
          <p>{{ tip.text }}</p>
        </details>
        <p class="ph-fine">
          Basic tips only, not a replacement for first-aid training. Tell your guide right away
          if someone is hurt. In an emergency, call 911.
        </p>
      </div>
    </section>
  `,
  styles: [`
    .ph { margin-top: 6px; }

    .ph-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 22px 0 10px;
    }
    .ph-title {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
      color: var(--app-text);
    }
    .ph-plan {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 9px;
      border-radius: 999px;
      background: var(--app-accent-soft);
      color: var(--app-accent);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .ph-plan.muted {
      background: transparent;
      border: 1px solid var(--app-border-strong);
      color: var(--app-text-dim);
    }

    .ph-card {
      margin-bottom: 10px;
      padding: 14px;
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      background: var(--app-card-bg);
    }
    .ph-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }
    .ph-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--app-text);
    }
    .ph-label ion-icon { font-size: 16px; color: var(--app-accent); }
    .ph-count { font-size: 12px; color: var(--app-accent); font-weight: 600; }

    /* Difficulty */
    .ph-diff { display: flex; gap: 12px; align-items: flex-start; }
    .ph-icon {
      flex-shrink: 0;
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border-radius: 12px;
      border: 1px solid var(--app-border);
      background: var(--app-bg-raised);
    }
    .ph-icon ion-icon { font-size: 19px; color: var(--app-accent); }
    .ph-diff-text { flex: 1; min-width: 0; }
    .ph-diff-text .diff-badge { margin-left: 8px; vertical-align: middle; }
    .ph-diff-text p {
      margin: 8px 0 0;
      font-size: 13px;
      line-height: 1.55;
      color: var(--app-text-soft, var(--app-text-dim));
    }

    /* Checklist */
    .ph-progress {
      height: 5px;
      margin-bottom: 8px;
      border-radius: 999px;
      background: var(--app-bg-raised);
      overflow: hidden;
    }
    .ph-progress span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--app-accent);
      transition: width 0.2s ease;
    }
    .ph-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 9px 2px;
      border: none;
      border-bottom: 1px solid var(--app-border);
      background: transparent;
      color: var(--app-text);
      font-size: 13.5px;
      text-align: left;
    }
    .ph-item:last-of-type { border-bottom: none; }
    .ph-item.done > span:last-child { color: var(--app-text-dim); text-decoration: line-through; }
    .ph-box {
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      display: grid;
      place-items: center;
      border-radius: 7px;
      border: 1.5px solid var(--app-border-strong);
    }
    .ph-item.done .ph-box {
      border-color: var(--app-accent);
      background: var(--app-accent);
      color: var(--app-on-accent, #161d18);
    }
    .ph-box ion-icon { font-size: 15px; }

    .ph-preview { position: relative; }
    .ph-item.preview { opacity: 0.55; cursor: default; }
    .ph-more { margin: 8px 2px 12px; font-size: 12px; color: var(--app-text-dim); }
    .ph-unlock {
      width: 100%;
      min-height: 46px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      border: none;
      border-radius: 999px;
      background: var(--app-cta, #e3e6bf);
      box-shadow: var(--app-cta-shadow, none);
      color: var(--app-on-accent, #161d18);
      font-size: 13.5px;
      font-weight: 600;
    }
    .ph-unlock ion-icon { font-size: 16px; }

    /* First-aid tips */
    .ph-tip { border-bottom: 1px solid var(--app-border); }
    .ph-tip summary {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 11px 2px;
      list-style: none;
      cursor: pointer;
      font-size: 13.5px;
      font-weight: 500;
      color: var(--app-text);
    }
    .ph-tip summary::-webkit-details-marker { display: none; }
    .ph-tip summary ion-icon { font-size: 16px; color: var(--app-accent); flex-shrink: 0; }
    .ph-tip summary span { flex: 1; }
    .ph-tip summary .chev { color: var(--app-text-dim); transition: transform 0.15s ease; }
    .ph-tip[open] summary .chev { transform: rotate(180deg); }
    .ph-tip p {
      margin: 0 0 12px 28px;
      font-size: 13px;
      line-height: 1.55;
      color: var(--app-text-soft, var(--app-text-dim));
    }
    .ph-sub { display: block; margin: 4px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--app-text-dim); }
    .ph-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .ph-chips button {
      padding: 6px 11px; border-radius: 999px; border: 1px solid var(--app-border-strong);
      background: transparent; color: var(--app-text-dim); font-size: 12px; font-weight: 600;
    }
    .ph-chips button.on { background: var(--app-accent); border-color: var(--app-accent); color: var(--app-on-accent, #161d18); }
    .ph-wx { margin: 0 0 6px; font-size: 12.5px; color: var(--app-text); }
    .ph-smart-text { display: flex; flex-direction: column; gap: 1px; }
    .ph-smart-text small { font-size: 11px; color: var(--app-accent); text-decoration: none; }
    .ph-fine {
      margin: 12px 0 0;
      font-size: 11.5px;
      line-height: 1.5;
      color: var(--app-text-dim);
    }
  `],
})
export class PrepareHikeComponent implements OnChanges {
  @Input({ required: true }) trail!: Trail;

  private readonly subscriptions = inject(SubscriptionService);
  private readonly router = inject(Router);
  private readonly weather = inject(TrailWeatherService);

  readonly tips = FIRST_AID_TIPS;
  readonly basicPrice = planById('basic')?.pricePerMonth ?? 79;

  private readonly difficultyLevel = signal<Difficulty>('Easy');
  private readonly packed = signal<ReadonlySet<string>>(new Set());

  /** Any TrailBound plan unlocks the full section. */
  readonly unlocked = computed(() => this.subscriptions.has('prepareForHike'));
  readonly planName = computed(() => this.subscriptions.activePlan()?.name ?? '');

  readonly difficulty = computed(() => DIFFICULTY_INFO[this.difficultyLevel()] ?? DIFFICULTY_INFO.Easy);
  readonly gear = computed(() => gearFor(this.difficultyLevel()));
  readonly packedCount = computed(() => this.gear().filter((g) => this.packed().has(g.id)).length);

  // ── Pro: smart checklist ──────────────────────────────────────────────
  readonly tripLengths = TRIP_LENGTHS;
  readonly smartUnlocked = computed(() => this.subscriptions.has('smartPrepare'));
  private readonly trailId = signal('');
  readonly nights = signal(0);
  readonly dayIndex = signal(0);
  private readonly forecastState = computed(() => this.weather.stateFor(this.trailId()));
  readonly forecastDays = computed(() => this.forecastState().data?.days ?? []);
  readonly hikeDay = computed(() => this.forecastDays()[this.dayIndex()] ?? this.forecastDays()[0]);
  readonly weatherNote = computed(() => {
    const s = this.forecastState();
    if (s.status === 'error') return 'Forecast unavailable, so weather items are skipped. Check your connection.';
    if (!weatherRequestFor(this.trail)) return 'No coordinates on file for this trail, so weather items are skipped.';
    return 'Getting the forecast for this trail…';
  });
  readonly smartGear = computed(() => {
    const day = this.hikeDay();
    return [...(day ? weatherGear(day) : []), ...multiDayGear(this.nights(), day ? day.tempMinC : null)];
  });
  readonly smartPackedCount = computed(() => this.smartGear().filter((g) => this.packed().has(g.id)).length);

  constructor() {
    addIcons({
      bandageOutline, checkmark, chevronDownOutline, lockClosedOutline, medkitOutline,
      speedometerOutline, starOutline,
    });
  }

  ngOnChanges() {
    if (!this.trail) return;
    this.difficultyLevel.set(DIFFICULTY_INFO[this.trail.difficulty] ? this.trail.difficulty : 'Easy');
    this.packed.set(this.readPacked());
    this.trailId.set(this.trail.id);
    this.nights.set(this.readNights());
    const req = weatherRequestFor(this.trail);
    if (req) this.weather.load(req);
  }

  setNights(n: number) {
    this.nights.set(n);
    try {
      localStorage.setItem(STORAGE_PREFIX + this.trail.id + '.nights', String(n));
    } catch {
      // Storage unavailable.
    }
  }

  private readNights(): number {
    try {
      const n = Number(localStorage.getItem(STORAGE_PREFIX + this.trail.id + '.nights'));
      return Number.isFinite(n) && n >= 0 && n <= 3 ? n : 0;
    } catch {
      return 0;
    }
  }

  isPacked(id: string): boolean {
    return this.packed().has(id);
  }

  togglePacked(id: string) {
    if (!this.unlocked()) return;
    const next = new Set(this.packed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.packed.set(next);
    try {
      localStorage.setItem(STORAGE_PREFIX + this.trail.id, JSON.stringify([...next]));
    } catch {
      // Storage unavailable — ticks last until the page closes.
    }
  }

  goPlans() {
    this.router.navigate(['/subscription']);
  }

  private readPacked(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + this.trail.id);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }
}
