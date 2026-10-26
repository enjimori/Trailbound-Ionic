/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HIKER ALERTS — what happened to my bookings and documents
 *
 * Built live from data the hiker can already read (firestore.rules allows
 * their own bookings and certificates), so nothing extra is stored:
 *
 *   their own actions   booking received, certificate uploaded, balance sent
 *   admin's actions     booking confirmed / cancelled, permit sent to the
 *                       office, documents need a correction, certificate
 *                       approved / rejected, refund recorded
 *   office's decision   permit issued (with the balance due date) or refused
 *   guide's record      hike completed, or marked a no-show
 *   reminders           the day before and the morning of a confirmed hike
 *
 * Each event has a stable id built from the booking and the state it reached,
 * so a new state shows up as a new unread notification while one already read
 * stays read. NotificationService merges these with "someone you follow
 * posted" for the Notifications page and the bell badges.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { onAuthStateChanged } from 'firebase/auth';
import { type Unsubscribe, collection, onSnapshot, query, where } from 'firebase/firestore';
import { addIcons } from 'ionicons';
import {
  alarmOutline, alertCircleOutline, cardOutline, cashOutline, checkmarkCircleOutline,
  checkmarkDoneOutline, closeCircleOutline, documentAttachOutline, documentTextOutline,
  flagOutline, paperPlaneOutline, receiptOutline, ribbonOutline,
} from 'ionicons/icons';
import { auth, db } from './firebase.client';
import { CertificateService } from './certificate.service';
import type { AppNotification } from '../models/notification.model';
import {
  type NoteInput, NotificationReadState, asDate, buildFeed, daysUntil, minuteClock,
  shortDate, shortDay, startOfToday,
} from './notification.util';

/** The booking fields these notifications read, straight from Firestore. */
interface HikerBookingDoc {
  id: string;
  reference: string;
  trailId: string;
  trailName: string;
  date: string;
  guideName: string;
  status: string;
  paperwork: string;
  payment: string;
  permitLodged: boolean;
  permitOffice: string;
  permitRef: string;
  permitNote: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  permitIssuedAt: Date | null;
  balanceDueBy: Date | null;
  demoBalancePaid: boolean;
  demoBalancePaidAt: Date | null;
}

const BOOKINGS = '/tabs/bookings';
const DOCUMENTS = '/documents';

@Injectable({ providedIn: 'root' })
export class HikerAlertsService {
  private readonly certs = inject(CertificateService);
  private readonly readState = new NotificationReadState('trailbound.hikerAlerts.read');
  private readonly clock = minuteClock();

  private readonly _bookings = signal<HikerBookingDoc[]>([]);
  private unsub?: Unsubscribe;

  readonly alerts = computed<AppNotification[]>(() => {
    const now = this.clock();
    const events: NoteInput[] = [];
    for (const b of this._bookings()) events.push(...bookingEvents(b, new Date(now)));

    const medical = this.certs.records()['medical'];
    if (medical) {
      if (medical.uploadedAt) {
        events.push({
          id: `cert-${medical.id}-up-${medical.uploadedAt.getTime()}`,
          at: medical.uploadedAt,
          type: 'document', tone: 'accent', icon: 'document-attach-outline',
          title: 'Medical certificate uploaded',
          message: 'TrailBound will review it before your hike.',
          link: { path: DOCUMENTS },
        });
      }
      if (medical.reviewedAt && medical.status === 'approved') {
        events.push({
          id: `cert-${medical.id}-approved-${medical.reviewedAt.getTime()}`,
          at: medical.reviewedAt,
          type: 'document', tone: 'success', icon: 'checkmark-done-outline',
          title: 'Medical certificate approved',
          message: 'Your certificate is verified. Nothing else to upload.',
          link: { path: DOCUMENTS },
        });
      }
      if (medical.reviewedAt && medical.status === 'rejected') {
        events.push({
          id: `cert-${medical.id}-rejected-${medical.reviewedAt.getTime()}`,
          at: medical.reviewedAt,
          type: 'document', tone: 'danger', icon: 'alert-circle-outline',
          title: 'Medical certificate needs attention',
          message: medical.note || 'TrailBound could not accept this file. Upload a clearer or newer copy.',
          link: { path: DOCUMENTS },
        });
      }
    }

    return buildFeed(events, this.readState.read(), now);
  });

  constructor() {
    addIcons({
      alarmOutline, alertCircleOutline, cardOutline, cashOutline, checkmarkCircleOutline,
      checkmarkDoneOutline, closeCircleOutline, documentAttachOutline, documentTextOutline,
      flagOutline, paperPlaneOutline, receiptOutline, ribbonOutline,
    });

    // Follow the signed-in hiker's bookings live, so an admin's or office's
    // change shows up without reopening the Bookings tab.
    onAuthStateChanged(auth, (user) => {
      this.unsub?.();
      this.unsub = undefined;
      this._bookings.set([]);
      if (!user) return;
      this.unsub = onSnapshot(
        query(collection(db, 'bookings'), where('uid', '==', user.uid)),
        (snap) => this._bookings.set(snap.docs.map((d) => toDoc(d.id, d.data({ serverTimestamps: 'estimate' })))),
        (err) => console.warn('Could not follow bookings for notifications.', err),
      );
    });
  }

  /** True for ids this feed created. */
  owns(id: string): boolean {
    return id.startsWith('bk-') || id.startsWith('cert-');
  }

  /** Marks one notification read. */
  markRead(id: string): void {
    this.readState.mark([id]);
  }

  /** Marks everything currently listed as read. */
  markAllRead(): void {
    this.readState.mark(this.alerts().map((a) => a.id));
  }
}

/** Every notification one booking has produced so far. */
function bookingEvents(b: HikerBookingDoc, now: Date): NoteInput[] {
  const out: NoteInput[] = [];
  const ref = `#${b.reference}`;
  const trail = b.trailName || 'your trail';
  const on = b.date ? ` on ${shortDay(b.date)}` : '';
  const changed = b.updatedAt ?? b.createdAt;
  const link = { path: BOOKINGS };

  // ── the hiker's own action ──
  out.push({
    id: `bk-${b.id}-placed`, at: b.createdAt,
    type: 'booking', tone: 'accent', icon: 'receipt-outline',
    title: 'Booking received',
    message: `${trail}${on} · ${ref}. TrailBound will check your documents and permit next.`,
    link,
  });

  if (b.demoBalancePaid) {
    out.push({
      id: `bk-${b.id}-balance-sent`, at: b.demoBalancePaidAt ?? changed,
      type: 'booking', tone: 'accent', icon: 'card-outline',
      title: 'Balance payment sent',
      message: `${trail} ${ref}. TrailBound will confirm your hike once it is checked.`,
      link,
    });
  }

  // ── documents and permit (admin, then the office) ──
  switch (b.paperwork) {
    case 'awaiting_docs':
      out.push({
        id: `bk-${b.id}-paper-awaiting`, at: b.createdAt,
        type: 'document', tone: 'warning', icon: 'document-text-outline',
        title: 'Upload your medical certificate',
        message: `${trail} needs a fit-to-hike certificate before the permit can be applied for.`,
        link: { path: DOCUMENTS },
      });
      break;
    case 'needs_correction':
      out.push({
        id: `bk-${b.id}-paper-correction`, at: changed,
        type: 'document', tone: 'warning', icon: 'document-text-outline',
        title: 'Documents need a correction',
        message: `TrailBound asked for a fix before applying for your ${trail} permit.`,
        link: { path: DOCUMENTS },
      });
      break;
    case 'permit_pending':
      if (b.permitLodged) {
        out.push({
          id: `bk-${b.id}-permit-sent`, at: changed,
          type: 'permit', tone: 'info', icon: 'paper-plane-outline',
          title: 'Permit application sent',
          message: `TrailBound sent your ${trail} application to ${b.permitOffice || 'the issuing office'}.`,
          link,
        });
      }
      break;
    case 'cleared': {
      const due = b.payment === 'balance_due' && b.balanceDueBy
        ? ` Pay the balance by ${shortDate(b.balanceDueBy)}.`
        : '';
      out.push({
        id: `bk-${b.id}-permit-issued`, at: b.permitIssuedAt ?? changed,
        type: 'permit', tone: 'success', icon: 'ribbon-outline',
        title: 'Permit issued',
        message: `${b.permitOffice || 'The office'} issued your ${trail} permit${b.permitRef ? ` (${b.permitRef})` : ''}.${due}`,
        link,
      });
      break;
    }
    case 'denied':
      out.push({
        id: `bk-${b.id}-permit-denied`, at: changed,
        type: 'permit', tone: 'danger', icon: 'close-circle-outline',
        title: 'Permit refused',
        message: b.permitNote || `${b.permitOffice || 'The office'} did not issue a permit for ${trail}${on}.`,
        link,
      });
      break;
  }

  // ── where the trip stands (admin, or the guide at the trailhead) ──
  switch (b.status) {
    case 'confirmed':
      out.push({
        id: `bk-${b.id}-confirmed`, at: changed,
        type: 'booking', tone: 'success', icon: 'checkmark-circle-outline',
        title: 'Your hike is confirmed',
        message: `${trail}${on} · ${ref}${b.guideName ? ` with ${b.guideName}` : ''}. See you at the jump-off.`,
        link,
      });
      break;
    case 'cancelled':
      out.push({
        id: `bk-${b.id}-cancelled`, at: changed,
        type: 'booking', tone: 'danger', icon: 'close-circle-outline',
        title: 'Booking cancelled',
        message: `${trail}${on} · ${ref} was cancelled by TrailBound. Check the Bookings tab for details.`,
        link,
      });
      break;
    case 'completed':
      out.push({
        id: `bk-${b.id}-completed`, at: changed,
        type: 'booking', tone: 'success', icon: 'flag-outline',
        title: 'Hike completed',
        message: `Thanks for hiking ${trail}! Tap to leave a review.`,
        link: b.trailId ? { path: `/trail/${b.trailId}` } : link,
      });
      break;
    case 'no_show':
      out.push({
        id: `bk-${b.id}-noshow`, at: changed,
        type: 'booking', tone: 'warning', icon: 'alert-circle-outline',
        title: 'Marked as a no-show',
        message: `Your guide recorded that you did not make it to ${trail}${on}. Contact TrailBound if this is wrong.`,
        link,
      });
      break;
  }

  if (b.payment === 'refunded') {
    out.push({
      id: `bk-${b.id}-refunded`, at: changed,
      type: 'booking', tone: 'info', icon: 'cash-outline',
      title: 'Refund recorded',
      message: `TrailBound recorded a refund for ${trail} ${ref}.`,
      link,
    });
  }

  // ── reminders for a confirmed hike ──
  const days = b.status === 'confirmed' ? daysUntil(b.date, now) : null;
  if (days === 0 || days === 1) {
    out.push({
      id: `bk-${b.id}-remind-${b.date}-${days}`, at: startOfToday(now),
      type: 'reminder', tone: 'accent', icon: 'alarm-outline',
      title: days === 0 ? 'Your hike is today' : 'Your hike is tomorrow',
      message: `${trail}${b.guideName ? ` with ${b.guideName}` : ''}. Check the weather before you head out.`,
      link,
    });
  }

  return out;
}

function toDoc(id: string, d: Record<string, any>): HikerBookingDoc {
  return {
    id,
    reference: String(d['reference'] ?? id),
    trailId: String(d['trailId'] ?? ''),
    trailName: String(d['trailName'] ?? ''),
    date: String(d['date'] ?? ''),
    guideName: d['guideName'] ? String(d['guideName']) : '',
    // Bookings saved before the workflow have no status: leave them quiet
    // rather than announcing a confirmation that happened long ago.
    status: String(d['status'] ?? ''),
    paperwork: String(d['paperwork'] ?? ''),
    payment: String(d['payment'] ?? ''),
    permitLodged: d['permitLodged'] === true,
    permitOffice: d['permitOffice'] ? String(d['permitOffice']) : '',
    permitRef: d['permitRef'] ? String(d['permitRef']) : '',
    permitNote: d['permitNote'] ? String(d['permitNote']) : '',
    createdAt: asDate(d['createdAt']),
    updatedAt: asDate(d['updatedAt']),
    permitIssuedAt: asDate(d['permitIssuedAt']),
    balanceDueBy: asDate(d['balanceDueBy']),
    demoBalancePaid: d['demoBalancePaid'] === true,
    demoBalancePaidAt: asDate(d['demoBalancePaidAt']),
  };
}
