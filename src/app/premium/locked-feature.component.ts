/**
 * The lock shown wherever a subscription feature would be:
 *
 *   <app-locked-feature feature="budgetTracker" title="Real-time budget tracker"
 *     text="See your trip cost against your budget as you pick.">
 *     (optional preview inside, shown faded)
 *   </app-locked-feature>
 *
 * The plan and price on the button come from subscription.model.ts, so they
 * never disagree with the Subscription page. `compact` is a one-line strip.
 */
import { Component, Input, booleanAttribute, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chevronForwardOutline, lockClosedOutline } from 'ionicons/icons';

import { Feature, planFor } from '../models/subscription.model';

@Component({
  selector: 'app-locked-feature',
  standalone: true,
  imports: [CommonModule, IonIcon],
  template: `
    <button type="button" class="lf-strip" *ngIf="compact; else full" (click)="goPlans()">
      <ion-icon name="lock-closed-outline"></ion-icon>
      <span class="lf-strip-text"><b>{{ title }}</b> · {{ plan().shortName }}</span>
      <ion-icon class="chev" name="chevron-forward-outline"></ion-icon>
    </button>

    <ng-template #full>
      <section class="lf">
        <div class="lf-head">
          <span class="lf-icon"><ion-icon name="lock-closed-outline"></ion-icon></span>
          <div class="lf-text">
            <span class="lf-title">{{ title }}</span>
            <span class="lf-plan">{{ plan().name }}</span>
          </div>
        </div>
        <p class="lf-desc" *ngIf="text">{{ text }}</p>
        <div class="lf-preview" aria-hidden="true"><ng-content></ng-content></div>
        <button type="button" class="lf-btn" (click)="goPlans()">
          <ion-icon name="lock-closed-outline"></ion-icon>
          Unlock with {{ plan().name }} · ₱{{ plan().pricePerMonth }}/month
        </button>
      </section>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .lf {
      margin: 0 0 12px;
      padding: 14px;
      border: 1px dashed var(--app-border-strong);
      border-radius: var(--app-radius, 16px);
      background: var(--app-card-bg);
    }
    .lf-head { display: flex; align-items: center; gap: 10px; }
    .lf-icon {
      flex-shrink: 0;
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border-radius: 11px;
      background: var(--app-accent-soft, rgba(232, 217, 156, 0.12));
      color: var(--app-accent);
      font-size: 17px;
    }
    .lf-text { display: flex; flex-direction: column; min-width: 0; }
    .lf-title { font-size: 14px; font-weight: 600; color: var(--app-text); }
    .lf-plan { font-size: 11.5px; color: var(--app-accent); font-weight: 600; }
    .lf-desc { margin: 10px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--app-text-dim); }
    .lf-preview { margin-top: 10px; opacity: 0.45; pointer-events: none; filter: saturate(0.6); }
    .lf-preview:empty { display: none; }
    .lf-btn {
      width: 100%;
      min-height: 44px;
      margin-top: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      border: none;
      border-radius: 999px;
      background: var(--app-cta, #e3e6bf);
      box-shadow: var(--app-cta-shadow, none);
      color: var(--app-on-accent, #161d18);
      font-size: 13px;
      font-weight: 600;
    }
    .lf-strip {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      border: 1px dashed var(--app-border-strong);
      border-radius: 12px;
      background: transparent;
      color: var(--app-text-dim);
      font-size: 12.5px;
      text-align: left;
    }
    .lf-strip ion-icon { color: var(--app-accent); font-size: 15px; flex-shrink: 0; }
    .lf-strip b { color: var(--app-text); font-weight: 600; }
    .lf-strip-text { flex: 1; min-width: 0; }
    .lf-strip .chev { color: var(--app-text-dim); }
  `],
})
export class LockedFeatureComponent {
  private readonly router = inject(Router);
  private readonly featureName = signal<Feature>('prepareForHike');

  @Input({ required: true }) set feature(value: Feature) { this.featureName.set(value); }
  @Input() title = '';
  @Input() text = '';
  @Input({ transform: booleanAttribute }) compact = false;

  readonly plan = computed(() => planFor(this.featureName()));

  constructor() {
    addIcons({ chevronForwardOutline, lockClosedOutline });
  }

  goPlans() {
    void this.router.navigate(['/subscription']);
  }
}
