/**
 * Where Maya Sandbox sends the hiker back after paying (/payment-result).
 *
 * Reads the pending payment saved before leaving for Maya, checks the
 * payment's status with Maya, then finishes what was being paid for:
 *   booking      → saves the booking, opens the confirmation screen
 *   balance      → records the balance payment, opens the Bookings tab
 *   subscription → starts the plan, opens the Subscription page
 *
 * The pending payment is cleared BEFORE finishing, so refreshing this page
 * can never book the same hike twice.
 */
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, IonIcon, IonSpinner, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { alertCircleOutline, closeCircleOutline, homeOutline, refreshOutline } from 'ionicons/icons';

import { MayaPending, MayaService } from '../../services/maya.service';
import { BookingService } from '../../services/booking.service';
import { UserService } from '../../services/user.service';
import { SubscriptionService } from '../../services/subscription.service';
import { planById } from '../../models/subscription.model';
import { AdminSubscriptionService } from '../admin/admin-subscription.service';

/** What Maya-paid items are saved as (booking history, receipts, plan). */
const MAYA_LABEL = 'Maya (Sandbox)';

/**
 * A balance payment must be recorded as plain 'Maya': BookingService and
 * firestore.rules only accept 'Card', 'QRPh', 'Apple Pay' or 'Maya' there.
 */
const MAYA_BALANCE_LABEL = 'Maya';

type View =
  | { state: 'working' }
  | { state: 'cancelled' | 'failed'; pending: MayaPending | null; detail: string }
  | { state: 'missing' };

@Component({
  selector: 'app-payment-result',
  standalone: true,
  imports: [CommonModule, IonContent, IonIcon, IonSpinner],
  template: `
    <ion-content [fullscreen]="true">
      <div class="pr">
        <ng-container [ngSwitch]="view().state">
          <div *ngSwitchCase="'working'" class="pr-box">
            <ion-spinner name="crescent"></ion-spinner>
            <h1>Confirming your Maya payment…</h1>
            <p>Please don't close this page.</p>
          </div>

          <div *ngSwitchCase="'missing'" class="pr-box">
            <ion-icon name="alert-circle-outline"></ion-icon>
            <h1>Payment not found</h1>
            <p>
              This payment was already handled, or it expired (Maya checkouts last one hour).
              Check your Bookings tab before trying again.
            </p>
            <button class="pr-btn" (click)="go('/tabs/bookings')">Open Bookings</button>
            <button class="pr-link" (click)="go('/tabs/home')"><ion-icon name="home-outline"></ion-icon> Home</button>
          </div>

          <div *ngSwitchDefault class="pr-box">
            <ion-icon name="close-circle-outline"></ion-icon>
            <h1>{{ view().state === 'cancelled' ? 'Payment cancelled' : 'Payment didn’t go through' }}</h1>
            <p>{{ detailText() }}</p>
            <button class="pr-btn" (click)="tryAgain()"><ion-icon name="refresh-outline"></ion-icon> Try again</button>
            <button class="pr-link" (click)="go('/tabs/home')"><ion-icon name="home-outline"></ion-icon> Home</button>
          </div>
        </ng-container>
      </div>
    </ion-content>
  `,
  styles: [`
    .pr {
      min-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 24px;
    }
    .pr-box {
      max-width: 340px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      text-align: center;
      color: var(--app-text);
    }
    .pr-box > ion-icon { font-size: 46px; color: var(--app-accent); }
    ion-spinner { width: 40px; height: 40px; color: var(--app-accent); }
    h1 { margin: 6px 0 0; font-size: 20px; font-weight: 500; }
    p { margin: 0 0 8px; font-size: 13.5px; line-height: 1.55; color: var(--app-text-dim); }
    .pr-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 48px;
      padding: 0 26px;
      border: none;
      border-radius: 999px;
      background: var(--app-cta, #e3e6bf);
      color: var(--app-on-accent, #161d18);
      font-size: 14px;
      font-weight: 600;
    }
    .pr-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 8px;
      border: none;
      background: none;
      color: var(--app-accent);
      font-size: 13px;
      font-weight: 600;
    }
  `],
})
export class PaymentResultPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly maya = inject(MayaService);
  private readonly bookingService = inject(BookingService);
  private readonly userService = inject(UserService);
  private readonly subscriptions = inject(SubscriptionService);
  private readonly adminSubscription = inject(AdminSubscriptionService);
  private readonly toastCtrl = inject(ToastController);

  readonly view = signal<View>({ state: 'working' });

  constructor() {
    addIcons({ alertCircleOutline, closeCircleOutline, homeOutline, refreshOutline });
  }

  async ngOnInit() {
    const params = this.route.snapshot.queryParamMap;
    const status = params.get('status');
    const ref = params.get('ref');
    const pending = this.maya.loadPending();

    if (!pending || pending.ref !== ref) {
      this.view.set({ state: 'missing' });
      return;
    }

    if (status !== 'success') {
      this.maya.clearPending();
      this.view.set({
        state: status === 'cancel' ? 'cancelled' : 'failed',
        pending,
        detail: status === 'cancel'
          ? 'You left Maya before paying. Nothing was booked or charged.'
          : 'Maya declined the payment. Nothing was booked or charged.',
      });
      return;
    }

    // Double-check with Maya rather than trusting the address alone.
    let mayaStatus = '';
    try {
      mayaStatus = await this.maya.paymentStatus(pending.checkoutId);
    } catch (e) {
      if (pending.kind === 'adminSubscription') {
        console.error('Could not verify the Maya sandbox admin subscription payment.', e);
        this.view.set({
          state: 'failed',
          pending,
          detail: 'TrailBound could not verify this payment with Maya. The subscription was not activated; retry after Maya is available.',
        });
        return;
      }
      // Maya could not be reached. In the sandbox the success redirect is
      // accepted; a live app must confirm through Maya's webhooks instead.
      console.warn('Could not check the payment status with Maya; trusting the success redirect.', e);
      mayaStatus = 'PAYMENT_SUCCESS';
    }
    if (mayaStatus !== 'PAYMENT_SUCCESS') {
      this.maya.clearPending();
      this.view.set({ state: 'failed', pending, detail: `Maya reports the payment as ${mayaStatus || 'unknown'}. Nothing was booked.` });
      return;
    }

    this.maya.clearPending();
    await this.finish(pending);
  }

  detailText(): string {
    const v = this.view();
    return v.state === 'cancelled' || v.state === 'failed' ? v.detail : '';
  }

  /**
   * Back to checkout with the same booking, balance or plan.
   *
   * Home goes underneath first. The app reloaded when Maya sent the hiker
   * back, so otherwise checkout would be the first screen in Ionic's stack:
   * its back arrow would lead back to Maya's page, and Ionic would reuse that
   * same checkout screen the next time any checkout opens.
   */
  async tryAgain() {
    const v = this.view();
    const p = v.state === 'cancelled' || v.state === 'failed' ? v.pending : null;
    await this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
    if (!p) return;
    if (p.kind === 'adminSubscription') {
      await this.router.navigate(['/admin/subscription']);
    } else if (p.kind === 'booking') {
      this.bookingService.setDraft(p.draft);
      await this.router.navigate(['/checkout']);
    } else if (p.kind === 'balance') {
      await this.router.navigate(['/checkout'], { queryParams: { balance: p.bookingId } });
    } else {
      await this.router.navigate(['/checkout'], { queryParams: { plan: p.planId } });
    }
  }

  go(url: string) {
    this.router.navigateByUrl(url, { replaceUrl: true });
  }

  private async finish(p: MayaPending) {
    await this.userService.ready;
    try {
      if (p.kind === 'booking') {
        await this.bookingService.refreshForCurrentUser();
        const booking = this.bookingService.confirm(p.draft, MAYA_LABEL, null);
        await this.router.navigate(['/booking-confirmed', booking.id], { replaceUrl: true });
        return;
      }

      if (p.kind === 'balance') {
        await this.bookingService.refreshForCurrentUser();
        const recorded = await this.bookingService.simulateDemoBalancePayment(p.bookingId, MAYA_BALANCE_LABEL);
        await this.toast(recorded
          ? 'Balance paid with Maya (Sandbox). Your booking is awaiting confirmation.'
          : 'This booking had no balance due, so nothing was recorded.');
        await this.router.navigate(['/tabs/bookings'], {
          queryParams: recorded ? { demoBalancePaid: p.bookingId } : {},
          replaceUrl: true,
        });
        return;
      }

      if (p.kind === 'adminSubscription') {
        await this.adminSubscription.activate(p.ref);
        await this.toast('TrailBound Facilitator is active for one month.');
        await this.router.navigate(['/admin/subscription'], { replaceUrl: true });
        return;
      }

      await this.subscriptions.activate(p.planId, MAYA_LABEL);
      await this.toast(`You're now on ${planById(p.planId)?.name ?? 'your new plan'}.`);
      await this.router.navigate(['/subscription'], { replaceUrl: true });
    } catch (e) {
      console.error('Maya payment succeeded but finishing it failed.', e);
      this.view.set({
        state: 'failed',
        pending: p,
        detail: 'Maya accepted the test payment, but TrailBound could not save it. '
          + 'No real money moves in the sandbox, so you can safely try again.',
      });
    }
  }

  private async toast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2600, position: 'top', color: 'dark' });
    await t.present();
  }
}
