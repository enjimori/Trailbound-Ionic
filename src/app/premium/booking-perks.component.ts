/**
 * TrailBound Pro perks on the booking page.
 *
 *   <app-priority-banner [trail]="t"></app-priority-banner>
 *       High-demand trails only. Pro: "priority booking is on" — the booking
 *       is saved with priority: true and admins see it first. Otherwise: what
 *       Pro would add, with a link to the plans.
 *
 *   <app-merch-discount-note></app-merch-discount-note>
 *       Pro: "15% off merchandise" (taken off in BookingService.quote).
 *       Otherwise: a one-line lock.
 */
import { Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { flashOutline, pricetagOutline } from 'ionicons/icons';

import { Trail } from '../models/trail.model';
import { MERCH_DISCOUNT_RATE, planFor } from '../models/subscription.model';
import { SubscriptionService } from '../services/subscription.service';
import { LockedFeatureComponent } from './locked-feature.component';
import { isHighDemandTrail } from './premium';

const BOX = `
  .pb {
    display: flex; gap: 10px; align-items: flex-start;
    margin: 0 0 16px; padding: 12px 14px; border-radius: 14px;
    border: 1px solid rgba(var(--app-accent-rgb, 232, 217, 156), 0.45);
    background: rgba(var(--app-accent-rgb, 232, 217, 156), 0.08);
  }
  .pb.off { border-style: dashed; border-color: var(--app-border-strong); background: transparent; }
  .pb > ion-icon { flex-shrink: 0; margin-top: 1px; font-size: 18px; color: var(--app-accent); }
  .pb b { display: block; font-size: 13px; color: var(--app-text); }
  .pb p { margin: 2px 0 0; font-size: 12px; line-height: 1.45; color: var(--app-text-dim); }
  .pb button { margin-top: 6px; padding: 0; border: none; background: none; color: var(--app-accent); font-size: 12px; font-weight: 600; }
`;

@Component({
  selector: 'app-priority-banner',
  standalone: true,
  imports: [CommonModule, IonIcon],
  template: `
    <div class="pb" *ngIf="highDemand()" [class.off]="!unlocked()">
      <ion-icon name="flash-outline"></ion-icon>
      <div *ngIf="unlocked(); else upsell">
        <b>Priority booking is on</b>
        <p>{{ trailName() }} is a high-demand trail. As a {{ planName() }} member your booking goes to the front of TrailBound's review queue.</p>
      </div>
      <ng-template #upsell>
        <div>
          <b>High-demand trail</b>
          <p>{{ trailName() }} fills up fast. {{ proName }} members get priority booking — their requests are reviewed first.</p>
          <button type="button" (click)="goPlans()">See {{ proName }} · ₱{{ proPrice }}/month</button>
        </div>
      </ng-template>
    </div>
  `,
  styles: [BOX],
})
export class PriorityBannerComponent {
  @Input({ required: true }) set trail(value: Trail | undefined) { this.trailSig.set(value); }

  private readonly subscriptions = inject(SubscriptionService);
  private readonly router = inject(Router);
  private readonly trailSig = signal<Trail | undefined>(undefined);

  readonly highDemand = computed(() => isHighDemandTrail(this.trailSig()));
  readonly unlocked = computed(() => this.subscriptions.has('priorityBooking'));
  readonly trailName = computed(() => this.trailSig()?.name ?? 'This trail');
  readonly planName = computed(() => this.subscriptions.activePlan()?.name ?? '');
  readonly proName = planFor('priorityBooking').name;
  readonly proPrice = planFor('priorityBooking').pricePerMonth;

  constructor() {
    addIcons({ flashOutline });
  }

  goPlans() {
    void this.router.navigate(['/subscription']);
  }
}

@Component({
  selector: 'app-merch-discount-note',
  standalone: true,
  imports: [CommonModule, IonIcon, LockedFeatureComponent],
  template: `
    <div class="pb" *ngIf="unlocked(); else locked">
      <ion-icon name="pricetag-outline"></ion-icon>
      <div>
        <b>{{ pct }}% off merchandise</b>
        <p>Your {{ planName() }} discount is taken off the total below.</p>
      </div>
    </div>
    <ng-template #locked>
      <app-locked-feature compact feature="merchDiscount" [title]="pct + '% off merchandise'"></app-locked-feature>
    </ng-template>
  `,
  styles: [BOX + ` :host { display: block; margin: 0 0 12px; } .pb { margin: 0; }`],
})
export class MerchDiscountNoteComponent {
  private readonly subscriptions = inject(SubscriptionService);
  readonly pct = Math.round(MERCH_DISCOUNT_RATE * 100);
  readonly unlocked = computed(() => this.subscriptions.has('merchDiscount'));
  readonly planName = computed(() => this.subscriptions.activePlan()?.name ?? '');

  constructor() {
    addIcons({ pricetagOutline });
  }
}
