/**
 * TrailBound Basic — real-time budget tracker during booking.
 *
 *   <app-budget-tracker [quote]="q"></app-budget-tracker>
 *
 * The hiker sets a budget once (remembered on this device). As they pick a
 * package, activities, merchandise or more group hikers, the meter shows how
 * much of it the trip uses, what is left (or how far over), and where the
 * money goes. The Total Trip Cost card below stays visible to everyone.
 * Without a plan: a faded preview with an unlock button.
 */
import { Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { createOutline, walletOutline } from 'ionicons/icons';

import { BookingQuote } from '../models/booking.model';
import { SubscriptionService } from '../services/subscription.service';
import { LockedFeatureComponent } from './locked-feature.component';
import { readLocal, writeLocal } from './premium';

const STORAGE_KEY = 'trailbound.tripBudget';
const QUICK = [1500, 3000, 5000, 8000];

interface Slice { label: string; amount: number; color: string; }

@Component({
  selector: 'app-budget-tracker',
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, LockedFeatureComponent],
  template: `
    <ng-container *ngIf="unlocked(); else locked">
      <section class="bt">
        <div class="bt-head">
          <span class="bt-title"><ion-icon name="wallet-outline"></ion-icon> Budget tracker</span>
          <button type="button" class="bt-edit" *ngIf="budget() && !editing()" (click)="startEdit()">
            <ion-icon name="create-outline"></ion-icon> ₱{{ budget() | number }}
          </button>
        </div>

        <!-- Setting the budget -->
        <div class="bt-set" *ngIf="!budget() || editing()">
          <label for="bt-input">What's your budget for this trip?</label>
          <div class="bt-input-row">
            <span class="peso">₱</span>
            <input id="bt-input" type="number" inputmode="numeric" min="1" max="1000000"
              [(ngModel)]="draft" placeholder="e.g. 3000" (keyup.enter)="save()" />
            <button type="button" (click)="save()" [disabled]="!validDraft()">Set</button>
          </div>
          <div class="bt-quick">
            <button type="button" *ngFor="let q of quick" (click)="draft = q; save()">₱{{ q | number }}</button>
          </div>
        </div>

        <!-- The meter -->
        <ng-container *ngIf="budget() && !editing()">
          <div class="bt-meter" [class.over]="over() > 0" role="meter" [attr.aria-valuenow]="total()"
            [attr.aria-valuemax]="budget()">
            <span [style.width.%]="usedPct()"></span>
          </div>
          <div class="bt-figures">
            <span><b>₱{{ total() | number }}</b> of ₱{{ budget() | number }}</span>
            <span class="bt-left" *ngIf="over() === 0">₱{{ left() | number }} left</span>
            <span class="bt-over" *ngIf="over() > 0">₱{{ over() | number }} over budget</span>
          </div>
          <p class="bt-tip" *ngIf="over() > 0">Remove an add-on or some merchandise, or pick a smaller package, to get back under.</p>

          <div class="bt-split" aria-hidden="true">
            <span *ngFor="let s of slices()" [style.flex]="s.amount" [style.background]="s.color"></span>
          </div>
          <ul class="bt-legend">
            <li *ngFor="let s of slices()"><i [style.background]="s.color"></i>{{ s.label }} <b>₱{{ s.amount | number }}</b></li>
          </ul>
          <p class="bt-due" *ngIf="quote">Due at checkout ₱{{ quote.deposit | number }} · balance later ₱{{ quote.balance | number }}</p>
        </ng-container>
      </section>
    </ng-container>

    <ng-template #locked>
      <app-locked-feature feature="budgetTracker" title="Real-time budget tracker"
        text="Set a budget and watch it update as you pick a package, add-ons and merchandise.">
        <div class="bt-meter"><span style="width: 62%"></span></div>
        <div class="bt-figures"><span><b>₱1,860</b> of ₱3,000</span><span class="bt-left">₱1,140 left</span></div>
      </app-locked-feature>
    </ng-template>
  `,
  styles: [`
    :host { display: block; margin-top: 18px; }
    .bt { padding: 14px; border-radius: var(--app-radius, 16px); border: 1px solid var(--app-border); background: var(--app-card-bg); }
    .bt-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .bt-title { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: var(--app-text); }
    .bt-title ion-icon { color: var(--app-accent); font-size: 17px; }
    .bt-edit { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--app-border-strong); background: transparent; color: var(--app-text); font-size: 12px; }
    .bt-set label { display: block; margin-bottom: 8px; font-size: 12.5px; color: var(--app-text-dim); }
    .bt-input-row { display: flex; align-items: center; gap: 8px; }
    .bt-input-row .peso { color: var(--app-text-dim); }
    .bt-input-row input { flex: 1; min-width: 0; height: 42px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--app-border-strong); background: var(--app-bg-raised); color: var(--app-text); font-size: 15px; }
    .bt-input-row button { height: 42px; padding: 0 18px; border: none; border-radius: 999px; background: var(--app-cta, #e3e6bf); color: var(--app-on-accent, #161d18); font-weight: 600; }
    .bt-input-row button:disabled { opacity: 0.45; }
    .bt-quick { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .bt-quick button { padding: 6px 11px; border-radius: 999px; border: 1px solid var(--app-border); background: transparent; color: var(--app-text-dim); font-size: 12px; }
    .bt-meter { height: 10px; border-radius: 999px; background: var(--app-bg-raised); overflow: hidden; }
    .bt-meter span { display: block; height: 100%; border-radius: inherit; background: #5fd97a; transition: width 0.25s ease; }
    .bt-meter.over span { background: #e8846b; }
    .bt-figures { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 12.5px; color: var(--app-text-dim); }
    .bt-figures b { color: var(--app-text); }
    .bt-left { color: #5fd97a; font-weight: 600; }
    .bt-over { color: #e8846b; font-weight: 600; }
    .bt-tip { margin: 6px 0 0; font-size: 11.5px; color: #e8846b; }
    .bt-split { display: flex; height: 6px; gap: 2px; margin-top: 12px; border-radius: 999px; overflow: hidden; }
    .bt-legend { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; }
    .bt-legend li { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--app-text-dim); }
    .bt-legend li b { margin-left: auto; color: var(--app-text); font-weight: 600; }
    .bt-legend i { width: 8px; height: 8px; border-radius: 3px; flex-shrink: 0; }
    .bt-due { margin: 10px 0 0; font-size: 11.5px; color: var(--app-text-dim); }
  `],
})
export class BudgetTrackerComponent {
  @Input() quote: BookingQuote | null = null;

  private readonly subscriptions = inject(SubscriptionService);

  readonly quick = QUICK;
  readonly unlocked = computed(() => this.subscriptions.has('budgetTracker'));
  readonly budget = signal<number>(readLocal<number>(STORAGE_KEY, 0));
  readonly editing = signal(false);
  draft: number | null = null;

  /** Re-read on every change detection — the quote input changes with each pick. */
  total(): number { return this.quote?.total ?? 0; }
  left(): number { return Math.max(0, this.budget() - this.total()); }
  over(): number { return Math.max(0, this.total() - this.budget()); }
  usedPct(): number { return this.budget() ? Math.min(100, (this.total() / this.budget()) * 100) : 0; }

  slices(): Slice[] {
    const q = this.quote;
    if (!q) return [];
    const merch = q.merchTotal - (q.merchDiscount ?? 0);
    return [
      { label: 'Package', amount: q.packagePrice, color: '#e8d99c' },
      { label: 'Add-ons', amount: q.activitiesTotal, color: '#7fc8a9' },
      { label: 'Merchandise', amount: merch, color: '#9ab6ff' },
      { label: 'Group hikers', amount: q.groupSurcharge, color: '#d9a7e8' },
      { label: 'Fee', amount: q.transactionFee, color: '#8a948c' },
    ].filter((s) => s.amount > 0);
  }

  validDraft(): boolean {
    const n = Number(this.draft);
    return Number.isFinite(n) && n >= 1 && n <= 1_000_000;
  }

  startEdit() {
    this.draft = this.budget();
    this.editing.set(true);
  }

  save() {
    if (!this.validDraft()) return;
    const n = Math.round(Number(this.draft));
    this.budget.set(n);
    writeLocal(STORAGE_KEY, n);
    this.editing.set(false);
  }

  constructor() {
    addIcons({ createOutline, walletOutline });
  }
}
