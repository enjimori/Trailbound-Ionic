/**
 * What the hiker pays now, and where to read the terms. Sits on checkout,
 * above the payment form.
 *
 * ── WHY THIS IS SMALL ─────────────────────────────────────────────────────
 * At checkout the hiker needs ONE fact: you are paying ₱190 today, not
 * ₱1,490, and the rest follows later. Everything else is detail they want
 * available, not detail they want in the way. An earlier version expanded the
 * full terms inline and pushed the card form off the screen, which made the
 * terms harder to read rather than easier.
 *
 * So: two numbers, one sentence, one link. The terms open in a sheet with
 * room to breathe.
 *
 * The total is deliberately NOT repeated here — the order summary directly
 * above already states it, and two different cards showing ₱1,490 invites the
 * reader to work out whether they are the same number.
 *
 * ── WHY THE TERMS ARE STILL ONE TAP AWAY ──────────────────────────────────
 * A refund policy a hiker meets only when asking for a refund is the most
 * complained-about pattern in booking apps. One tap from the pay button, with
 * real peso amounts rather than percentages, is the honest middle: "₱720
 * back" is a fact someone can act on, "50% of the refundable portion" is a
 * puzzle.
 *
 *   <app-refund-policy
 *     [total]="quote()!.total"
 *     [deposit]="payNow()"
 *     [transactionFee]="50">
 *   </app-refund-policy>
 */
import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonModal } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronForwardOutline, closeOutline, informationCircleOutline, shieldCheckmarkOutline,
} from 'ionicons/icons';
import { BALANCE_WINDOW_DAYS, CANCELLATION_TIERS, REFUND_POLICY_VERSION, refundFor } from '../../models/booking-workflow';

@Component({
  selector: 'app-refund-policy',
  standalone: true,
  imports: [CommonModule, IonIcon, IonModal],
  template: `
    <section class="rp">
      <div class="amounts">
        <div class="now">
          <span class="lbl">
            <ion-icon name="shield-checkmark-outline"></ion-icon>
            Pay now
          </span>
          <strong>&#8369;{{ deposit | number: '1.0-0' }}</strong>
        </div>
        <div class="then">
          <span class="lbl">Then, once your permit is released</span>
          <span class="amt">&#8369;{{ balance() | number: '1.0-0' }}</span>
        </div>
      </div>

      <p class="note">
        Your deposit holds the date. The hike is confirmed once your documents and permit
        are cleared — you will have {{ windowDays }} days to pay the balance.
      </p>

      <button type="button" class="link" (click)="termsOpen.set(true)">
        Refund terms
        <ion-icon name="chevron-forward-outline"></ion-icon>
      </button>
    </section>

    <ion-modal
      class="terms-sheet"
      [isOpen]="termsOpen()"
      [initialBreakpoint]="0.85"
      [breakpoints]="[0, 0.85, 1]"
      (didDismiss)="termsOpen.set(false)"
    >
      <ng-template>
        <div class="sheet">
          <header>
            <h2>Refund terms</h2>
            <button type="button" class="close" (click)="termsOpen.set(false)" aria-label="Close">
              <ion-icon name="close-outline"></ion-icon>
            </button>
          </header>

          <h3>If you cancel</h3>
          <ul class="tiers">
            <li *ngFor="let t of tiers()">
              <span>{{ t.label }}</span>
              <b [class.none]="t.back === 0">&#8369;{{ t.back | number: '1.0-0' }}</b>
            </li>
          </ul>

          <h3>Everything else</h3>
          <dl class="cases">
            <div>
              <dt>We cancel — closed trail, weather, no guide</dt>
              <dd>Everything back, transaction fee included. Or reschedule free.</dd>
            </div>
            <div>
              <dt>Your permit or documents are refused</dt>
              <dd>&#8369;{{ refusedBack() | number: '1.0-0' }} back. We keep the &#8369;{{ transactionFee }} transaction fee and any fee already paid to the issuing office for you.</dd>
            </div>
            <div>
              <dt>You miss the balance deadline</dt>
              <dd>The date is released and the deposit is not returned.</dd>
            </div>
            <div>
              <dt>You do not join on the day</dt>
              <dd>Not refundable — your guide and permit were both booked.</dd>
            </div>
          </dl>

          <p class="fine">
            <ion-icon name="information-circle-outline"></ion-icon>
            The &#8369;{{ transactionFee }} transaction fee is what our payment provider charges
            to process the payment. It comes back only when we are the ones who cancel.
          </p>

          <p class="ver">Terms version {{ version }}</p>
        </div>
      </ng-template>
    </ion-modal>
  `,
  styles: [`
    /* ── the panel ── */

    .rp {
      border-radius: 16px;
      background: rgba(19, 29, 25, 0.9);
      border: 1px solid var(--app-border-strong, rgba(238, 240, 231, 0.14));
      padding: 14px 16px;
      color: var(--app-text, #eef0e7);
    }

    .amounts { display: flex; flex-direction: column; gap: 2px; }

    .now {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 14px;
    }
    .now .lbl {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 13.5px;
      font-weight: 600;
    }
    .now .lbl ion-icon { font-size: 16px; color: var(--app-accent, #8fbf6a); }
    .now strong {
      font-family: var(--app-font-serif, Georgia, serif);
      font-size: 24px;
      font-weight: 600;
      color: var(--app-accent, #8fbf6a);
      font-variant-numeric: tabular-nums;
    }

    .then {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 14px;
      font-size: 12.5px;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }
    .then .amt { font-variant-numeric: tabular-nums; white-space: nowrap; }

    .note {
      margin: 11px 0 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }

    .link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 10px;
      padding: 4px 0;
      border: 0;
      background: none;
      color: var(--app-accent, #8fbf6a);
      font-size: 12.5px;
      font-weight: 600;
    }
    .link ion-icon { font-size: 14px; }

    /* ── the sheet ── */

    ion-modal.terms-sheet {
      --background: var(--app-bg, #0d1511);
      --border-radius: 24px;
    }

    .sheet {
      padding: 24px 22px 36px;
      color: var(--app-text, #eef0e7);
      overflow-y: auto;
      max-height: 100%;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 22px;
    }
    h2 { margin: 0; font-size: 20px; font-weight: 600; }
    .close {
      flex: none;
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: rgba(238, 240, 231, 0.08);
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
      font-size: 19px;
    }

    h3 {
      margin: 0 0 9px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }
    h3 + * { margin-bottom: 26px; }

    .tiers { list-style: none; margin: 0; padding: 0; }
    .tiers li {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 11px 0;
      border-bottom: 1px solid rgba(238, 240, 231, 0.08);
      font-size: 13.5px;
    }
    .tiers li:last-child { border-bottom: 0; }
    .tiers b {
      white-space: nowrap;
      color: #7fd09a;
      font-variant-numeric: tabular-nums;
    }
    .tiers b.none { color: var(--ion-color-danger, #f0505a); }

    .cases { margin: 0; }
    .cases > div { padding: 12px 0; border-bottom: 1px solid rgba(238, 240, 231, 0.08); }
    .cases > div:last-child { border-bottom: 0; }
    .cases dt { font-size: 13.5px; font-weight: 600; }
    .cases dd {
      margin: 4px 0 0;
      font-size: 12.5px;
      line-height: 1.55;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }

    .fine {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin: 0;
      padding: 12px 13px;
      border-radius: 12px;
      background: rgba(238, 240, 231, 0.04);
      font-size: 11.5px;
      line-height: 1.55;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }
    .fine ion-icon { flex: none; font-size: 14px; margin-top: 2px; }

    .ver {
      margin: 14px 0 0;
      font-size: 10.5px;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }
  `],
})
export class RefundPolicyComponent {
  /** Everything the hike costs, including the transaction fee. */
  @Input({ required: true }) total = 0;

  /** Taken at checkout: permit fee plus the transaction fee. */
  @Input({ required: true }) deposit = 0;

  /** The payment provider's cut. */
  @Input() transactionFee = 50;

  readonly termsOpen = signal(false);
  readonly windowDays = BALANCE_WINDOW_DAYS;
  readonly version = REFUND_POLICY_VERSION;

  readonly balance = computed(() => Math.max(0, this.total - this.deposit));

  /**
   * The tiers as money rather than percentages, worked out against the full
   * amount — by the time someone cancels they will usually have paid it all.
   * Nothing is lodged with the issuing office at checkout time, so
   * permitFeeLodged is 0 here.
   */
  readonly tiers = computed(() =>
    CANCELLATION_TIERS.map((t) => ({
      label: t.label,
      back: refundFor({
        reason: 'hiker_cancelled',
        grossPaid: this.total,
        transactionFee: this.transactionFee,
        permitFeeLodged: 0,
        daysBeforeHike: t.minDays,
      }).refunded,
    })),
  );

  /** A refused permit and refused documents come to the same number. */
  readonly refusedBack = computed(
    () =>
      refundFor({
        reason: 'permit_denied',
        grossPaid: this.total,
        transactionFee: this.transactionFee,
        permitFeeLodged: 0,
        daysBeforeHike: 30,
      }).refunded,
  );

  constructor() {
    addIcons({
      chevronForwardOutline, closeOutline, informationCircleOutline, shieldCheckmarkOutline,
    });
  }
}
