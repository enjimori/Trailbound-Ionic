/**
 * Subscription service: knows the signed-in hiker's TrailBound plan and answers
 * "can this user use feature X?" for every page.
 *
 * The plan is saved on the hiker's own document as users/{uid}.subscription,
 * next to profile and upcoming. A copy is also kept on the device, so the plan
 * still works if Firestore refuses the write (for example, if the security
 * rules only allow certain fields) — the warning in the console says so.
 *
 * Billing is monthly and does not renew by itself: when renewsAt passes, the
 * plan ends and the hiker subscribes again.
 */
import { Injectable, computed, signal } from '@angular/core';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase.client';
import {
  FEATURE_PLANS, Feature, PlanId, UserSubscription, isCustomerPlan, planById,
} from '../models/subscription.model';

const DEVICE_KEY = 'trailbound.subscription.';

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly _subscription = signal<UserSubscription | null>(null);
  private readonly _now = signal(Date.now());
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  /** The saved subscription, including an ended or cancelled one. */
  readonly subscription = this._subscription.asReadonly();

  /** The plan the hiker can use right now, or null (no plan, or it has ended). */
  readonly activePlanId = computed<PlanId | null>(() => {
    const s = this._subscription();
    if (!s || !isCustomerPlan(s.plan) || !planById(s.plan)) return null;
    return new Date(s.renewsAt).getTime() > this._now() ? s.plan : null;
  });

  readonly activePlan = computed(() => planById(this.activePlanId()) ?? null);

  /** Resolves once the first sign-in state (and plan) has loaded. */
  readonly ready: Promise<void>;

  private uid: string | null = null;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      onAuthStateChanged(auth, async (user) => {
        this.uid = user?.uid ?? null;
        await this.load(this.uid);
        resolve();
      });
    });
  }

  /** True when the hiker's current plan includes this feature. */
  has(feature: Feature): boolean {
    const plan = this.activePlanId();
    return !!plan && FEATURE_PLANS[feature].includes(plan);
  }

  /**
   * Starts (or switches to) a plan for one month, after payment succeeded.
   * Throws 'Not signed in.' for guests.
   */
  async activate(planId: PlanId, paymentMethod: string): Promise<void> {
    if (!isCustomerPlan(planId)) throw new Error('This plan is only available in the admin area.');
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not signed in.');
    const start = new Date();
    const renews = new Date(start);
    renews.setMonth(renews.getMonth() + 1);
    await this.save(uid, {
      plan: planId,
      status: 'active',
      startedAt: start.toISOString(),
      renewsAt: renews.toISOString(),
      paymentMethod,
    });
  }

  /** Cancels renewal. The hiker keeps the plan until renewsAt. */
  async cancel(): Promise<void> {
    const uid = auth.currentUser?.uid;
    const current = this._subscription();
    if (!uid || !current) return;
    await this.save(uid, { ...current, status: 'cancelled' }, true);
  }

  // ── storage ─────────────────────────────────────────────────────────────

  private async load(uid: string | null): Promise<void> {
    if (!uid) {
      this._subscription.set(null);
      return;
    }
    let fromCloud: UserSubscription | null = null;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      fromCloud = (snap.exists() ? (snap.data()['subscription'] as UserSubscription) : null) ?? null;
    } catch (e) {
      console.warn('Could not read the subscription from Firestore; using this device\'s copy.', e);
    }
    // Ignore a late result if the user changed while we were loading.
    if (this.uid !== uid) return;
    this._subscription.set(fromCloud ?? this.readDevice(uid));
    this.refreshExpiry();
  }

  private async save(uid: string, sub: UserSubscription, requireCloud = false): Promise<void> {
    if (requireCloud) {
      try {
        await setDoc(doc(db, 'users', uid), { subscription: sub }, { merge: true });
      } catch (e) {
        console.error('Could not save the subscription cancellation to Firestore.', e);
        throw new Error('Could not save your cancellation. Please check your connection and try again.');
      }
    }
    this._subscription.set(sub);
    this.writeDevice(uid, sub);
    this.refreshExpiry();
    if (requireCloud) return;
    try {
      await setDoc(doc(db, 'users', uid), { subscription: sub }, { merge: true });
    } catch (e) {
      console.warn('Firestore refused the subscription write; it is saved on this device only.', e);
    }
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

  private readDevice(uid: string): UserSubscription | null {
    try {
      const raw = localStorage.getItem(DEVICE_KEY + uid);
      return raw ? (JSON.parse(raw) as UserSubscription) : null;
    } catch {
      return null;
    }
  }

  private writeDevice(uid: string, sub: UserSubscription): void {
    try {
      localStorage.setItem(DEVICE_KEY + uid, JSON.stringify(sub));
    } catch {
      // Storage unavailable — the Firestore copy is the only one.
    }
  }
}
