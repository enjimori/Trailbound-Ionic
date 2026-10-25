/**
 * Booking-history controller: reads the signed-in hiker's bookings from
 * BookingService and prepares their progress, status and display data.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonIcon,
  IonLabel,
  IonModal,
  IonSegment,
  IonSegmentButton,
  ToastController,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowForward,
  bagHandleOutline,
  calendarOutline,
  cardOutline,
  checkmarkCircleOutline,
  closeOutline,
  compassOutline,
  imageOutline,
  lockClosedOutline,
  locationOutline,
  personOutline,
  printOutline,
  receiptOutline,
  shieldCheckmarkOutline,
  sparklesOutline,
  ticketOutline,
  timeOutline,
  warning,
} from 'ionicons/icons';

import { Booking } from '../../models/booking.model';
import { BookingService } from '../../services/booking.service';
import { TrailService } from '../../services/trail.service';
import { BookingProgressComponent } from '../booking/booking-progress.component';
import { permitFeeFor, permitFor } from '../explore/trail-permits';
import { isGeneratedRef } from '../admin/office/permit-ref';
import {
  type BookingStatus,
  type ProgressStep,
  STATUS_LABEL,
  balanceFor,
  bookingProgress,
  depositFor,
  detailsUnlocked,
  readWorkflow,
} from '../../models/booking-workflow';

/**
 * BOOKING HISTORY — replaces the Planner tab, and now the place a hiker
 * tracks a booking rather than only looking one up.
 *
 * ── WHY THE TRACKER LIVES HERE ────────────────────────────────────────────
 * A booking is no longer confirmed the moment it is paid for. It waits on a
 * document review, then on an issuing office, then on the balance. Without a
 * tracker that reads as silence, and a hiker who has paid and heard nothing
 * assumes something is broken. This page answers "where is my booking, and is
 * it waiting on me?".
 *
 * All of the reasoning is in bookingProgress() in booking-workflow.ts, so
 * this page and the admin panel cannot disagree about what state a booking is
 * in.
 *
 * ── OLDER BOOKINGS ────────────────────────────────────────────────────────
 * Bookings written before the workflow existed have no paperwork or payment
 * fields at all. readWorkflow() defaults those to cleared and paid, so they
 * render as finished rather than as broken — re-opening settled history would
 * be worse than the inconsistency.
 */

type HistoryTab = 'upcoming' | 'past';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Kept local rather than imported from booking-catalog so this page has one
 * fewer dependency; if the fee there ever changes, change it here too.
 */
const TRANSACTION_FEE = 50;

/** A booking with everything the template needs worked out once. */
interface BookingRow {
  b: Booking;
  status: BookingStatus;
  statusLabel: string;
  statusKey: string;
  steps: ProgressStep[];
  /** The step the booking is sitting on, for the one-line hint on the card. */
  current: ProgressStep | null;
  permitIssuedAt: Date | null;
  demoBalancePaid: boolean;
  /** Receipt and full details are held back until the hike is confirmed. */
  unlocked: boolean;
  deposit: number;
  balance: number;
  paidSoFar: number;
}

@Component({
  selector: 'app-booking-history',
  standalone: true,
  templateUrl: './booking-history.page.html',
  styleUrls: ['./booking-history.page.scss'],
  imports: [
    DatePipe,
    DecimalPipe,
    IonHeader,
    IonToolbar,
    IonContent,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonIcon,
    IonModal,
    BookingProgressComponent,
  ],
})
export class BookingHistoryPage {
  private readonly bookingService = inject(BookingService);
  private readonly trailService = inject(TrailService);
  private readonly router = inject(Router);
  private readonly toastCtrl = inject(ToastController);

  readonly tab = signal<HistoryTab>('upcoming');

  /** Booking shown in the Details sheet */
  readonly selected = signal<BookingRow | null>(null);
  readonly detailsOpen = signal(false);

  /** Trail photo URLs that failed to load (shows an icon instead) */
  readonly brokenImages = signal<ReadonlySet<string>>(new Set());

  /** Hike date is today or later — soonest first */
  readonly upcoming = computed(() => {
    const today = todayKey();
    return this.bookingService
      .bookings()
      .filter((b) => b.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
  });

  /** Hike date already passed — most recent first */
  readonly past = computed(() => {
    const today = todayKey();
    return this.bookingService
      .bookings()
      .filter((b) => b.date < today)
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  /**
   * The visible bookings with their progress worked out. Computed once per
   * change rather than from the template, so the steps are not rebuilt on
   * every change-detection pass.
   */
  readonly rows = computed<BookingRow[]>(() =>
    (this.tab() === 'upcoming' ? this.upcoming() : this.past()).map((b) => this.toRow(b)),
  );

  /** Upcoming hikes in the next 30 days — drives the reminder banner */
  readonly soonCount = computed(() => {
    const limit = Date.now() + 30 * DAY_MS;
    return this.upcoming().filter(
      (b) => b.status !== 'cancelled' && toDate(b.date).getTime() <= limit,
    ).length;
  });

  /** Upcoming bookings that are waiting on the hiker for something. */
  readonly needsYouCount = computed(
    () => this.rows().filter((r) => r.current?.state === 'blocked').length,
  );

  constructor() {
    addIcons({
      arrowForward,
      bagHandleOutline,
      calendarOutline,
      cardOutline,
      checkmarkCircleOutline,
      closeOutline,
      compassOutline,
      imageOutline,
      lockClosedOutline,
      locationOutline,
      personOutline,
      printOutline,
      receiptOutline,
      shieldCheckmarkOutline,
      sparklesOutline,
      ticketOutline,
      timeOutline,
      warning,
    });
  }

  ionViewWillEnter(): void {
    void this.bookingService.refreshForCurrentUser();
  }

  // ── building a row ───────────────────────────────────────────────────────

  private toRow(b: Booking): BookingRow {
    // The booking document may predate these fields entirely; readWorkflow
    // supplies sane defaults rather than letting undefined reach the screen.
    const wf = readWorkflow(b as unknown as Record<string, unknown>);
    const permit = permitFor(b.trailName);

    const status = this.effectiveStatus(b, wf.status);
    const total = Number(b.total ?? 0) || 0;
    const deposit = depositFor(permitFeeFor(b.trailName), TRANSACTION_FEE);
    const balance = balanceFor(total, deposit);
    const demoBalancePaid = this.bookingService.hasDemoBalancePayment(b.id);

    const raw = b as unknown as Record<string, unknown>;
    const steps = bookingProgress({
      status,
      paperwork: wf.paperwork,
      payment: demoBalancePaid ? 'paid_in_full' : wf.payment,
      requiresMedical: permit.requiresMedical,
      hasPermitAuthority: permit.authority !== 'none',
      permitOffice: permit.office,
      permitRef: (raw['permitRef'] as string) ?? null,
      balance,
      balanceDueBy: fmtDate(raw['balanceDueBy']),
      guideName: b.guideName ?? null,
    });
    if (demoBalancePaid) {
      const balanceStep = steps.find((step) => step.id === 'balance');
      if (balanceStep) balanceStep.detail = 'Submitted; awaiting booking confirmation.';
    }

    const documentsCleared = wf.paperwork === 'cleared' || wf.paperwork === 'not_required';
    const waitingForConfirmation = status === 'pending'
      && documentsCleared
      && (demoBalancePaid || wf.payment === 'paid_in_full');

    return {
      b,
      status,
      statusLabel: waitingForConfirmation ? 'Awaiting confirmation' : STATUS_LABEL[status].text,
      statusKey: statusKeyFor(status),
      steps,
      current: steps.find((s) => s.state !== 'done') ?? null,
      permitIssuedAt: asDate(raw['permitIssuedAt']),
      demoBalancePaid,
      unlocked: detailsUnlocked(status),
      deposit,
      balance,
      paidSoFar: wf.payment === 'paid_in_full' ? total : deposit,
    };
  }

  /**
   * An admin's word wins. Otherwise a confirmed hike whose date has passed
   * reads as completed, which is what a hiker expects to see.
   */
  private effectiveStatus(b: Booking, stored: BookingStatus): BookingStatus {
    if (stored === 'cancelled' || stored === 'completed' || stored === 'no_show') return stored;
    if (stored === 'confirmed' && this.isPast(b)) return 'completed';
    return stored;
  }

  // ── template helpers ─────────────────────────────────────────────────────

  /** Updates the selected history tab and the booking records shown below it. */
  onTabChange(value: unknown): void {
    if (value === 'upcoming' || value === 'past') {
      this.tab.set(value);
    }
  }

  /** Booking.date is a local "yyyy-mm-dd" string; DatePipe needs a Date. */
  toDate(key: string): Date {
    return toDate(key);
  }

  isPast(b: Booking): boolean {
    return b.date < todayKey();
  }

  isUpcomingHike(b: BookingRow): boolean {
    return b.status === 'confirmed' && b.b.date >= todayKey();
  }

  trailDuration(b: Booking): string | null {
    return this.trailService.getById(b.trailId)?.duration ?? null;
  }

  trailRegion(b: Booking): string | null {
    return this.trailService.getById(b.trailId)?.region ?? null;
  }

  isOvernightPackage(b: Booking): boolean {
    return b.packageName.toLowerCase().includes('overnight');
  }

  hasActivity(b: Booking, activity: string): boolean {
    return b.activityNames.some((name) => name.toLowerCase().includes(activity));
  }

  isGeneratedPermitRef(b: Booking): boolean {
    return isGeneratedRef(b.permitRef ?? null, b.reference, b.date);
  }

  canPayBalance(r: BookingRow): boolean {
    return r.b.status === 'pending'
      && r.b.paperwork === 'cleared'
      && r.b.payment === 'balance_due'
      && !r.demoBalancePaid;
  }

  payBalance(r: BookingRow): void {
    if (!this.canPayBalance(r)) return;
    this.detailsOpen.set(false);
    void this.router.navigate(['/checkout'], { queryParams: { balance: r.b.id } });
  }

  async printPermit(r: BookingRow): Promise<void> {
    const b = r.b;
    if (b.paperwork !== 'cleared' || !b.permitRef) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      const toast = await this.toastCtrl.create({
        message: 'Allow pop-ups for TrailBound to print your permit.',
        duration: 2800,
        position: 'top',
      });
      await toast.present();
      return;
    }

    const escape = (value: string): string =>
      value.replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char] ?? char);
    const date = (value: string | Date | null): string => {
      if (!value) return '—';
      const parsed = value instanceof Date ? value : new Date(`${value}T00:00:00`);
      return isNaN(parsed.getTime())
        ? '—'
        : new Intl.DateTimeFormat('en-PH', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }).format(parsed);
    };
    const generated = this.isGeneratedPermitRef(b);
    const fields: [string, string][] = [
      [generated ? 'TrailBound reference' : 'Office permit number', b.permitRef],
      ['Hiker', b.userName || '—'],
      ['Hike date', date(b.date)],
      ['Issuing office', b.permitOffice || 'Permit office'],
      ['Issued', date(r.permitIssuedAt)],
      ['Booking reference', `#${b.reference}`],
    ];
    const rows = fields
      .map(([label, value]) => `<div class="row"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`)
      .join('');

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Permit - ${escape(b.trailName)}</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; padding: 36px 20px; color: #17211b; font: 15px/1.5 Arial, sans-serif; }
            main { max-width: 700px; margin: 0 auto; padding: 34px; border: 1px solid #aab4aa; border-radius: 16px; }
            .brand { color: #43533e; font-size: 14px; font-weight: 700; }
            .eyebrow { margin: 30px 0 5px; color: #59635b; font-size: 11px; font-weight: 700; letter-spacing: .12em; }
            h1 { margin: 0 0 22px; font: 500 30px/1.2 Georgia, serif; }
            .row { display: flex; justify-content: space-between; gap: 24px; padding: 13px 0; border-top: 1px solid #dce1dc; }
            .row span { color: #59635b; }
            .row strong { text-align: right; overflow-wrap: anywhere; }
            .code { color: #43533e; font-size: 17px; }
            .notice { margin: 26px 0 0; padding-top: 16px; border-top: 1px solid #dce1dc; color: #59635b; font-size: 12px; }
            @media print {
              @page { size: A4; margin: 18mm; }
              body { padding: 0; }
              main { max-width: none; padding: 24px; }
            }
          </style>
        </head>
        <body>
          <main>
            <div class="brand">TrailBound</div>
            <p class="eyebrow">PERMIT APPROVAL RECORD</p>
            <h1>${escape(b.trailName)}</h1>
            ${rows}
            <p class="notice">
              This digital record confirms the permit details recorded for your booking.
              Follow any instructions from the issuing office; this is not a replacement
              for an official document they may require.
            </p>
          </main>
        </body>
      </html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.addEventListener('afterprint', () => printWindow.close(), { once: true });
    printWindow.setTimeout(() => printWindow.print(), 250);
  }

  /** Records an image that failed to load so the template can render a fallback. */
  markBroken(url: string): void {
    this.brokenImages.update((set) => new Set(set).add(url));
  }

  openDetails(r: BookingRow): void {
    this.selected.set(r);
    this.detailsOpen.set(true);
  }

  closeDetails(): void {
    this.detailsOpen.set(false);
  }

  findTrail(): void {
    this.router.navigate(['/tabs/explore']);
  }

  /** From a blocked step straight to the page that unblocks it. */
  act(step: ProgressStep): void {
    this.detailsOpen.set(false);
    if (step.id === 'documents') this.router.navigate(['/documents']);
    else if (step.id === 'balance') this.router.navigate(['/checkout']);
  }
}

/** Parse "yyyy-mm-dd" as local midnight (same approach as booking-confirmed). */
function toDate(key: string): Date {
  return new Date(key + 'T00:00:00');
}

/** Today's local date as "yyyy-mm-dd", so it compares directly with Booking.date. */
function todayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Firestore Timestamp, Date, ISO string or nothing — into "12 Nov". */
function fmtDate(v: unknown): string | null {
  if (!v) return null;
  const d =
    v instanceof Date
      ? v
      : typeof (v as { toDate?: unknown }).toDate === 'function'
        ? (v as { toDate: () => Date }).toDate()
        : new Date(String(v));
  return isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' });
}

function asDate(v: unknown): Date | null {
  if (!v) return null;
  const d =
    v instanceof Date
      ? v
      : typeof (v as { toDate?: unknown }).toDate === 'function'
        ? (v as { toDate: () => Date }).toDate()
        : new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

/** The four colours the stylesheet knows about. */
function statusKeyFor(s: BookingStatus): string {
  return s === 'no_show' ? 'cancelled' : s;
}