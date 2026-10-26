/**
 * TrailBound Basic — mountain suggestions by skill level (Home tab).
 *
 *   <app-skill-suggestions></app-skill-suggestions>
 *
 * The hiker picks Beginner, Intermediate or Experienced (remembered on this
 * device) and gets the open trails that fit, best first:
 *   Beginner      Easy trails, lowest first
 *   Intermediate  Moderate trails, plus the higher Easy ones as a step up
 *   Experienced   Hard trails, highest first
 * Without a plan: the level buttons and a faded preview, with an unlock button.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { trendingUpOutline } from 'ionicons/icons';

import { Trail } from '../models/trail.model';
import { SubscriptionService } from '../services/subscription.service';
import { CatalogService } from '../services/catalog.service';
import { TrailService } from '../services/trail.service';
import { LockedFeatureComponent } from './locked-feature.component';
import { parseMetres, readLocal, trailPool, writeLocal } from './premium';

export type SkillLevel = 'beginner' | 'intermediate' | 'experienced';

const LEVELS: { id: SkillLevel; label: string; hint: string }[] = [
  { id: 'beginner', label: 'Beginner', hint: 'First climbs, short and well-marked trails.' },
  { id: 'intermediate', label: 'Intermediate', hint: 'A few hikes done; ready for steeper, longer days.' },
  { id: 'experienced', label: 'Experienced', hint: 'Fit and trail-wise; long, technical or high climbs.' },
];

const STORAGE_KEY = 'trailbound.skillLevel';

interface Suggestion { trail: Trail; why: string; }

@Component({
  selector: 'app-skill-suggestions',
  standalone: true,
  imports: [CommonModule, IonIcon, LockedFeatureComponent],
  template: `
    <div class="ss-levels" role="radiogroup" aria-label="Your hiking level">
      <button type="button" *ngFor="let l of levels" role="radio"
        [attr.aria-checked]="level() === l.id" [class.on]="level() === l.id"
        (click)="setLevel(l.id)">{{ l.label }}</button>
    </div>

    <ng-container *ngIf="unlocked(); else locked">
      <p class="ss-hint">{{ hint() }}</p>
      <div class="ss-row">
        <button type="button" class="ss-card" *ngFor="let s of suggestions()" (click)="open(s.trail)">
          <span class="ss-photo" [style.backgroundImage]="'url(' + s.trail.image + ')'"></span>
          <span class="ss-body">
            <span class="ss-name">{{ s.trail.name }}</span>
            <span class="diff-badge" [ngClass]="s.trail.difficulty.toLowerCase()">{{ s.trail.difficulty }}</span>
            <span class="ss-why"><ion-icon name="trending-up-outline"></ion-icon>{{ s.why }}</span>
          </span>
        </button>
      </div>
    </ng-container>

    <ng-template #locked>
      <app-locked-feature feature="skillSuggestions" title="Mountain suggestions by skill level"
        text="Tell us your level and get the mountains that fit you, best first.">
        <div class="ss-row">
          <div class="ss-card" *ngFor="let s of suggestions().slice(0, 2)">
            <span class="ss-photo" [style.backgroundImage]="'url(' + s.trail.image + ')'"></span>
            <span class="ss-body"><span class="ss-name">{{ s.trail.name }}</span></span>
          </div>
        </div>
      </app-locked-feature>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .ss-levels { display: flex; gap: 8px; margin: 0 0 10px; }
    .ss-levels button {
      flex: 1; min-height: 36px; border-radius: 999px;
      border: 1px solid var(--app-border-strong); background: transparent;
      color: var(--app-text-dim); font-size: 12.5px; font-weight: 600;
    }
    .ss-levels button.on { background: var(--app-accent); border-color: var(--app-accent); color: var(--app-on-accent, #161d18); }
    .ss-hint { margin: 0 0 10px; font-size: 12.5px; color: var(--app-text-dim); }
    .ss-row { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; scroll-snap-type: x mandatory; }
    .ss-row::-webkit-scrollbar { display: none; }
    .ss-card {
      flex: 0 0 200px; scroll-snap-align: start;
      display: flex; flex-direction: column; padding: 0; overflow: hidden; text-align: left;
      border-radius: var(--app-radius, 16px); border: 1px solid var(--app-border); background: var(--app-card-bg);
    }
    .ss-photo { height: 96px; background: var(--app-bg-raised) center / cover no-repeat; }
    .ss-body { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; padding: 10px 11px 12px; }
    .ss-name { font-size: 13.5px; font-weight: 600; color: var(--app-text); }
    .ss-why { display: flex; gap: 5px; align-items: flex-start; font-size: 11.5px; line-height: 1.4; color: var(--app-text-dim); }
    .ss-why ion-icon { flex-shrink: 0; margin-top: 2px; color: var(--app-accent); }
  `],
})
export class SkillSuggestionsComponent {
  private readonly subscriptions = inject(SubscriptionService);
  private readonly catalog = inject(CatalogService);
  private readonly trailService = inject(TrailService);
  private readonly router = inject(Router);

  readonly levels = LEVELS;
  readonly level = signal<SkillLevel>(readLocal<SkillLevel>(STORAGE_KEY, 'beginner'));
  readonly unlocked = computed(() => this.subscriptions.has('skillSuggestions'));
  readonly hint = computed(() => LEVELS.find((l) => l.id === this.level())?.hint ?? '');

  readonly suggestions = computed<Suggestion[]>(() => {
    const open = trailPool(this.catalog, this.trailService)
      .filter((t) => String(t.status).toLowerCase() !== 'closed');
    const height = (t: Trail) => parseMetres(t.elevation) ?? 0;

    switch (this.level()) {
      case 'beginner':
        return open.filter((t) => t.difficulty === 'Easy')
          .sort((a, b) => height(a) - height(b))
          .slice(0, 8)
          .map((trail) => ({ trail, why: `Easy grade, ${trail.duration} — a good first climb` }));
      case 'intermediate': {
        const moderate = open.filter((t) => t.difficulty === 'Moderate').sort((a, b) => height(a) - height(b));
        const stepUp = open.filter((t) => t.difficulty === 'Easy').sort((a, b) => height(b) - height(a)).slice(0, 2);
        return [
          ...moderate.slice(0, 6).map((trail) => ({ trail, why: `Moderate, ${trail.elevation} — builds your stamina` })),
          ...stepUp.map((trail) => ({ trail, why: `Higher Easy trail (${trail.elevation}) for a relaxed day` })),
        ];
      }
      default:
        return open.filter((t) => t.difficulty === 'Hard')
          .sort((a, b) => height(b) - height(a))
          .slice(0, 8)
          .map((trail) => ({ trail, why: `Hard, ${trail.elevation} summit — a real challenge` }));
    }
  });

  constructor() {
    addIcons({ trendingUpOutline });
  }

  setLevel(level: SkillLevel) {
    this.level.set(level);
    writeLocal(STORAGE_KEY, level);
  }

  open(t: Trail) {
    void this.router.navigate(['/trail', t.id]);
  }
}
