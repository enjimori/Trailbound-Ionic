import { Injectable, computed, inject, signal } from '@angular/core';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import { adminAuth, adminDb } from './admin-firebase';
import { AdminAuthService } from './admin-auth.service';

export { FACILITATOR_ADMIN_PRICE } from '../../models/subscription.model';

export interface AdminSubscription {
  plan: 'facilitator';
  status: 'active' | 'cancelled';
  startedAt: string;
  renewsAt: string;
  paymentMethod: string;
  paymentReference: string;
  purchasedBy: string;
}

@Injectable({ providedIn: 'root' })
export class AdminSubscriptionService {
  private readonly adminSession = inject(AdminAuthService);
  private readonly _subscription = signal<AdminSubscription | null>(null);
  private readonly _now = signal(Date.now());
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  readonly subscription = this._subscription.asReadonly();
  readonly loaded = signal(false);
  readonly active = computed(() => {
    const sub = this._subscription();
    return !!sub && Date.parse(sub.renewsAt) > this._now();
  });

  async refresh(): Promise<void> {
    await this.adminSession.ready;
    if (!this.adminSession.isAdmin()) throw new Error('Admin access is required.');
    const snap = await getDoc(doc(adminDb, 'admin_subscriptions', 'facilitator'));
    const raw = snap.exists() ? snap.data() : null;
    const valid = raw?.['plan'] === 'facilitator'
      && (raw?.['status'] === 'active' || raw?.['status'] === 'cancelled')
      && typeof raw?.['renewsAt'] === 'string'
      && Number.isFinite(Date.parse(raw['renewsAt']));
    this._subscription.set(valid ? raw as AdminSubscription : null);
    this.refreshExpiry();
    this.loaded.set(true);
  }

  async activate(paymentReference: string): Promise<void> {
    await this.adminSession.ready;
    const user = adminAuth.currentUser;
    if (!user || !this.adminSession.isAdmin()) throw new Error('Admin access is required.');

    const now = new Date();
    const current = this._subscription();
    const previousExpiry = current?.status === 'active' ? Date.parse(current.renewsAt) : 0;
    const start = previousExpiry > now.getTime() ? new Date(previousExpiry) : now;
    const renews = new Date(start);
    renews.setMonth(renews.getMonth() + 1);
    const subscription: AdminSubscription = {
      plan: 'facilitator',
      status: 'active',
      startedAt: now.toISOString(),
      renewsAt: renews.toISOString(),
      paymentMethod: 'Maya (Sandbox)',
      paymentReference,
      purchasedBy: user.uid,
    };

    await setDoc(doc(adminDb, 'admin_subscriptions', 'facilitator'), subscription);
    this._subscription.set(subscription);
    this.refreshExpiry();
    this.loaded.set(true);
  }

  /** Stops renewal while preserving access through the already-paid period. */
  async cancel(): Promise<void> {
    await this.adminSession.ready;
    if (!this.adminSession.isAdmin()) throw new Error('Admin access is required.');
    const current = this._subscription();
    if (!current || current.status !== 'active' || !this.active()) {
      throw new Error('There is no active admin subscription to cancel.');
    }
    const subscription: AdminSubscription = { ...current, status: 'cancelled' };
    await setDoc(doc(adminDb, 'admin_subscriptions', 'facilitator'), subscription);
    this._subscription.set(subscription);
    this.refreshExpiry();
  }

  private refreshExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this._now.set(Date.now());
    const renewsAt = this._subscription()?.renewsAt;
    if (!renewsAt) return;
    const remaining = Date.parse(renewsAt) - Date.now();
    if (remaining <= 0) return;
    this.expiryTimer = setTimeout(() => this.refreshExpiry(), Math.min(remaining + 1, 2_147_000_000));
  }
}
