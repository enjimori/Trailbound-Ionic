import { Component, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircleOutline, diamondOutline, lockClosedOutline, walletOutline } from 'ionicons/icons';

import { AdminSubscriptionService, FACILITATOR_ADMIN_PRICE } from '../admin-subscription.service';
import { AdminAuthService } from '../admin-auth.service';
import { AdminUiService } from '../admin-ui.service';
import { MayaService } from '../../../services/maya.service';

@Component({
  selector: 'app-admin-subscription',
  standalone: true,
  imports: [DatePipe, DecimalPipe, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Admin Subscription</h1>
        <p>TrailBound Facilitator access for digital certification/document tracking and analytics.</p>
      </div>
    </div>

    <section class="tba-card" style="max-width: 760px">
      @if (!subscription.loaded()) {
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        } @else {
          <p class="muted pad">Checking subscription status…</p>
        }
      } @else {
        <div class="plan-head">
          <span class="plan-icon"><ion-icon name="diamond-outline"></ion-icon></span>
          <div>
            <h2>TrailBound Facilitator</h2>
            <p>₱{{ price | number }} per month · Maya Sandbox</p>
          </div>
          @if (subscription.active() && subscription.subscription()?.status === 'active') {
            <span class="tba-badge" data-tone="green"><ion-icon name="checkmark-circle-outline"></ion-icon> Active</span>
          } @else if (subscription.active()) {
            <span class="tba-badge" data-tone="sand"><ion-icon name="checkmark-circle-outline"></ion-icon> Cancels at renewal</span>
          } @else {
            <span class="tba-badge" data-tone="sand"><ion-icon name="lock-closed-outline"></ion-icon> Inactive</span>
          }
        </div>

        <ul class="features">
          <li>Digital certification and document tracking</li>
          <li>Admin analytics</li>
        </ul>

        @if (subscription.subscription(); as sub) {
          <p class="muted">
            @if (subscription.active() && sub.status === 'cancelled') {
              Renewal cancelled · access continues through
            } @else {
              Access {{ subscription.active() ? 'through' : 'ended' }}
            }
            {{ sub.renewsAt | date: 'MMM d, y' }} · paid with {{ sub.paymentMethod }}
          </p>
        }
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

        @if (subscription.active() && subscription.subscription()?.status === 'active') {
          <button class="tba-btn" type="button" [disabled]="busy()" (click)="cancel()">
            {{ busy() ? 'Cancelling…' : 'Cancel subscription' }}
          </button>
        }
        <button class="tba-btn primary" type="button" [disabled]="busy() || subscription.active()" (click)="subscribe()">
          <ion-icon name="wallet-outline"></ion-icon>
          {{ busy() ? 'Opening Maya…' : subscription.active() ? 'Subscription active' : 'Subscribe with Maya Sandbox' }}
        </button>
        <p class="muted fine">Sandbox only: this test checkout does not collect real money. Live billing requires server-side payment verification.</p>
      }
    </section>
  `,
  styles: [`
    .plan-head { display: flex; align-items: center; gap: 14px; }
    .plan-head > div { flex: 1; }
    .plan-head h2 { margin: 0; font-size: 18px; }
    .plan-head p { margin: 4px 0 0; color: var(--tba-muted); font-size: 13px; }
    .plan-icon { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center; background: var(--tba-sand-soft); font-size: 22px; }
    .plan-head .tba-badge { display: inline-flex; align-items: center; gap: 5px; }
    .features { margin: 20px 0; padding-left: 20px; line-height: 1.9; }
    .fine { margin-top: 14px; font-size: 12px; }
    .error { color: var(--tba-danger, #a33); }
  `],
})
export class AdminSubscriptionPage {
  readonly subscription = inject(AdminSubscriptionService);
  private readonly admin = inject(AdminAuthService);
  private readonly ui = inject(AdminUiService);
  private readonly maya = inject(MayaService);
  readonly price = FACILITATOR_ADMIN_PRICE;
  readonly busy = signal(false);
  readonly error = signal('');

  constructor() {
    addIcons({ checkmarkCircleOutline, diamondOutline, lockClosedOutline, walletOutline });
    void this.subscription.refresh().catch((e: unknown) => {
      const code = (e as { code?: string } | null)?.code;
      this.error.set(code === 'permission-denied'
        ? 'Firestore denied access to the subscription record. Publish the updated firestore.rules from this project, then reload this page.'
        : e instanceof Error ? e.message : 'Could not load the subscription.');
    });
  }

  async subscribe(): Promise<void> {
    if (this.busy() || this.subscription.active()) return;
    this.error.set('');
    this.busy.set(true);
    try {
      await this.admin.ready;
      const identity = this.admin.admin();
      if (!identity) throw new Error('Admin access is required.');
      await this.maya.startCheckout({
        purpose: { kind: 'adminSubscription' },
        amount: this.price,
        description: 'TrailBound Facilitator · Admin subscription',
        buyer: { name: identity.name, email: identity.email },
      });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not start Maya checkout.');
      this.busy.set(false);
    }
  }

  async cancel(): Promise<void> {
    if (this.busy() || !this.subscription.active()) return;
    const sub = this.subscription.subscription();
    if (!sub || sub.status !== 'active') return;
    const until = new Date(sub.renewsAt).toLocaleDateString('en-PH', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
    const confirmed = await this.ui.confirm({
      title: 'Cancel Admin Subscription?',
      message: `Renewal will stop. Certificates and analytics stay available until ${until}.`,
      confirmText: 'Cancel subscription',
      danger: true,
    });
    if (!confirmed) return;

    this.error.set('');
    this.busy.set(true);
    try {
      await this.subscription.cancel();
      this.ui.toast('Subscription cancelled. Access remains until the paid-through date.');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not cancel the subscription.');
    } finally {
      this.busy.set(false);
    }
  }
}
