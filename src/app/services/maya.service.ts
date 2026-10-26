/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MAYA SANDBOX — Maya Checkout in Maya's TEST environment
 *
 * How a Maya payment works:
 *   1. checkout calls startCheckout(): we ask Maya for a checkout page and
 *      save what is being paid for (the "pending" payment) on this device.
 *   2. The hiker is sent to Maya's page and pays with a Maya test account or
 *      test card. No real money moves in the sandbox.
 *   3. Maya sends the hiker back to /payment-result, which checks the payment
 *      status with Maya and then finishes the booking, balance or plan.
 *
 * Keys: the PUBLIC key below is Maya's shared sandbox key ("Sandbox Party 1"),
 * published by Maya for anyone to test with:
 * https://developers.maya.ph/reference/sandbox-credentials-and-cards
 * Creating a checkout and checking a payment's status both use the public key,
 * so no server is needed. Never put a SECRET key (sk-...) in this app.
 *
 * Going live would need your own Maya business account, production keys, and
 * a server that receives Maya's webhooks to confirm payments.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Injectable } from '@angular/core';
import { BookingDraft } from '../models/booking.model';
import { PlanId } from '../models/subscription.model';

export const MAYA_SANDBOX = {
  apiUrl: 'https://pg-sandbox.paymaya.com',
  publicKey: 'pk-Z0OSzLvIcOI2UIvDhdTGVVfRSSeiGStnceqwUE7n0Ah',
} as const;

/** Maya checkout pages expire after 1 hour. */
const PENDING_MAX_AGE_MS = 60 * 60 * 1000;
const PENDING_KEY = 'trailbound.mayaPending';

/** What the Maya payment is for. */
export type MayaPurpose =
  | { kind: 'booking'; draft: BookingDraft }
  | { kind: 'balance'; bookingId: string }
  | { kind: 'subscription'; planId: PlanId }
  | { kind: 'adminSubscription' };

export type MayaPending = MayaPurpose & {
  /** Our reference, sent to Maya as requestReferenceNumber. */
  ref: string;
  /** Maya's id for the checkout; it is also the payment id. */
  checkoutId: string;
  amount: number;
  createdAt: number;
};

export interface MayaCheckoutInput {
  purpose: MayaPurpose;
  amount: number;
  /** One line shown on Maya's page, e.g. "Deposit · Mt. Pulag". */
  description: string;
  buyer?: { name?: string; email?: string };
}

@Injectable({ providedIn: 'root' })
export class MayaService {
  /**
   * Creates a Maya checkout, saves the pending payment, and leaves the app for
   * Maya's page. Throws if Maya refuses the request.
   */
  async startCheckout(input: MayaCheckoutInput): Promise<void> {
    const ref = 'TB-' + Date.now().toString(36).toUpperCase()
      + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const back = (status: string) =>
      `${window.location.origin}/payment-result?status=${status}&ref=${encodeURIComponent(ref)}`;

    const [firstName, ...rest] = (input.buyer?.name ?? '').trim().split(/\s+/);
    const amount = Math.round(input.amount * 100) / 100;

    const body = {
      totalAmount: { value: amount, currency: 'PHP' },
      items: [{
        name: input.description.slice(0, 100),
        quantity: 1,
        amount: { value: amount },
        totalAmount: { value: amount },
      }],
      ...(firstName || input.buyer?.email ? {
        buyer: {
          ...(firstName ? { firstName, lastName: rest.join(' ') || firstName } : {}),
          ...(input.buyer?.email ? { contact: { email: input.buyer.email } } : {}),
        },
      } : {}),
      redirectUrl: { success: back('success'), failure: back('failure'), cancel: back('cancel') },
      requestReferenceNumber: ref,
      metadata: { app: 'TrailBound', purpose: input.purpose.kind },
    };

    const res = await fetch(`${MAYA_SANDBOX.apiUrl}/checkout/v1/checkouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Basic ' + btoa(MAYA_SANDBOX.publicKey + ':'),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.redirectUrl || !data?.checkoutId) {
      throw new Error('Maya checkout was not created: ' + JSON.stringify(data));
    }

    this.savePending({
      ...input.purpose,
      ref,
      checkoutId: data.checkoutId,
      amount,
      createdAt: Date.now(),
    });
    window.location.href = data.redirectUrl;
  }

  /**
   * Asks Maya for the payment's status, e.g. "PAYMENT_SUCCESS",
   * "PAYMENT_FAILED", "PAYMENT_CANCELLED", "PAYMENT_EXPIRED".
   * Throws if Maya cannot be reached.
   */
  async paymentStatus(paymentId: string): Promise<string> {
    const res = await fetch(
      `${MAYA_SANDBOX.apiUrl}/payments/v1/payments/${encodeURIComponent(paymentId)}/status`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: 'Basic ' + btoa(MAYA_SANDBOX.publicKey + ':'),
        },
      },
    );
    if (!res.ok) throw new Error('Maya status check failed: HTTP ' + res.status);
    const data = await res.json();
    return String(data?.status ?? '');
  }

  // ── the pending payment (survives the trip to Maya and back) ────────────

  loadPending(): MayaPending | null {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as MayaPending;
      if (Date.now() - p.createdAt > PENDING_MAX_AGE_MS) {
        this.clearPending();
        return null;
      }
      return p;
    } catch {
      return null;
    }
  }

  clearPending(): void {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      // nothing to clear
    }
  }

  private savePending(p: MayaPending): void {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    } catch {
      throw new Error('This browser blocked storage, so the Maya payment cannot be tracked.');
    }
  }
}
