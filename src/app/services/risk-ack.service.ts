/**
 * Risk acknowledgment — who accepted what, and when.
 *
 * Held in memory for the session, like BookingDraft. That is deliberate: the
 * acknowledgment belongs to the booking being made right now, and a stored
 * "you agreed last month" is not an acknowledgment of today's conditions.
 * When the booking is written, the timestamp and version travel with it and
 * become the durable record.
 *
 * ── WHY A VERSION STRING ──────────────────────────────────────────────────
 * The wording will change. If someone later asks what a hiker actually agreed
 * to on a given date, "they ticked the box" is not an answer — the version is.
 * Bump RISK_ACK_VERSION whenever the text in risk-ack.component.ts changes,
 * and never edit old wording in place.
 */
import { Injectable, signal } from '@angular/core';

/** Bump this whenever the acknowledgment wording changes. */
export const RISK_ACK_VERSION = '2026-10-22';

export interface RiskAck {
  at: Date;
  version: string;
}

@Injectable({ providedIn: 'root' })
export class RiskAckService {
  /** Keyed by trail id: accepting for one mountain says nothing about another. */
  private readonly _acks = signal<Record<string, RiskAck>>({});
  readonly acks = this._acks.asReadonly();

  /** Performs the accept operation for this feature and returns its result to the caller. */
  accept(trailId: string): RiskAck {
    const ack: RiskAck = { at: new Date(), version: RISK_ACK_VERSION };
    this._acks.update((m) => ({ ...m, [trailId]: ack }));
    return ack;
  }

  /**
   * Whether this trail has a current acceptance. False once the wording has
   * changed under them — an acknowledgment of superseded text is not one.
   */
  hasAccepted(trailId: string): boolean {
    return this._acks()[trailId]?.version === RISK_ACK_VERSION;
  }

  /** Performs the ack for operation for this feature and returns its result to the caller. */
  ackFor(trailId: string): RiskAck | null {
    return this._acks()[trailId] ?? null;
  }

  /** Call after a booking is written, so the next one asks again. */
  clear(trailId: string): void {
    this._acks.update((m) => {
      const next = { ...m };
      delete next[trailId];
      return next;
    });
  }
}
