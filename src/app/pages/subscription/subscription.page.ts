/**
 * Subscription page: shows the three TrailBound plans, the hiker's current
 * plan, and sends them to checkout (?plan=...) to subscribe.
 *
 * Guests can browse the plans. Subscribing needs an account, so a guest who
 * taps Subscribe is sent to sign in first.
 */
import { Component, computed, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router } from '@angular/router';
import { AlertController, IonContent, IonIcon, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline, checkmarkCircle, checkmarkOutline, diamondOutline, star,
} from 'ionicons/icons';

import { CUSTOMER_SUBSCRIPTION_PLANS, SubscriptionPlan } from '../../models/subscription.model';
import { SubscriptionService } from '../../services/subscription.service';
import { UserService } from '../../services/user.service';

@Component({
  selector: 'app-subscription',
  standalone: true,
  templateUrl: './subscription.page.html',
  styleUrls: ['./subscription.page.scss'],
  imports: [CommonModule, IonContent, IonIcon],
})
export class SubscriptionPage {
  readonly subscriptions = inject(SubscriptionService);
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly plans = CUSTOMER_SUBSCRIPTION_PLANS;

  /** The saved subscription, but only while it still gives access. */
  readonly current = computed(() => {
    const s = this.subscriptions.subscription();
    const plan = this.subscriptions.activePlan();
    return s && plan ? { ...s, plan } : null;
  });

  constructor() {
    addIcons({ arrowBackOutline, checkmarkCircle, checkmarkOutline, diamondOutline, star });
  }

  isCurrent(p: SubscriptionPlan): boolean {
    const c = this.current();
    return !!c && c.plan.id === p.id && c.status === 'active';
  }

  buttonLabel(p: SubscriptionPlan): string {
    if (this.isCurrent(p)) return 'Current plan';
    const c = this.current();
    if (c && c.plan.id === p.id) return 'Renew plan';
    return c ? `Switch to ${p.shortName}` : `Subscribe · ₱${p.pricePerMonth}/month`;
  }

  async choose(p: SubscriptionPlan) {
    if (this.isCurrent(p)) return;
    if (!this.userService.isAuthenticated()) {
      await this.toast('Sign in or create an account to subscribe.');
      await this.router.navigate(['/login']);
      return;
    }
    await this.router.navigate(['/checkout'], { queryParams: { plan: p.id } });
  }

  async confirmCancel() {
    const c = this.current();
    if (!c) return;
    const until = new Date(c.renewsAt).toLocaleDateString('en-PH', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
    const alert = await this.alertCtrl.create({
      header: 'Cancel your plan?',
      message: `You keep ${c.plan.name} until ${until}. It won't renew after that.`,
      buttons: [
        { text: 'Keep plan', role: 'cancel' },
        {
          text: 'Cancel plan',
          role: 'destructive',
          handler: async () => {
            try {
              await this.subscriptions.cancel();
              await this.toast(`${c.plan.name} is cancelled. You keep it until ${until}.`);
            } catch (e) {
              await this.toast(e instanceof Error ? e.message : 'Could not cancel your plan.');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  goBack() {
    if (window.history.length > 1) this.location.back();
    else this.router.navigate(['/tabs/profile']);
  }

  private async toast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color: 'dark' });
    await t.present();
  }
}
