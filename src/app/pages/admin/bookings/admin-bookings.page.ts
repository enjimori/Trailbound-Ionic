/**
 * Bookings — every booking from every hiker. Filter, open one to see the full
 * receipt, move it through the permit workflow, cancel it, or delete it.
 * Export to CSV.
 *
 * A booking has three tracks that move independently, so they are shown
 * separately rather than squashed into one word:
 *
 *   status      pending → confirmed → completed   (or cancelled / no_show)
 *   paperwork   awaiting_docs → under_review → permit_pending → cleared
 *   payment     deposit_paid → balance_due → paid_in_full
 *
 * Paying the deposit holds the date; it does not confirm the hike. Staff send
 * the permit application and record what the office issued. Once paperwork
 * and payment are complete, staff confirm the booking. Test balance
 * submissions are identified separately and never count as money received.
 */
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, checkmarkDoneOutline, checkmarkOutline, closeCircleOutline, closeOutline,
  documentTextOutline, downloadOutline, hourglassOutline, personOutline,
  receiptOutline, refreshOutline, ribbonOutline, searchOutline, trashOutline,
} from 'ionicons/icons';

import {
  AdminBooking, AdminDataService, BookingStatus, countsAsRevenue, effectiveStatus, receivedFrom,
} from '../admin-data.service';
import { AdminUiService } from '../admin-ui.service';
import { fromDayKey, matches, peso } from '../admin-utils';
import { CatalogService } from '../../../services/catalog.service';
import type { PaperworkStatus, PaymentStatus } from '../../../models/booking-workflow';

type Filter = 'all' | 'awaiting_confirmation' | BookingStatus;

/** Plain English for the documents-and-permit track. */
const PAPERWORK_LABEL: Record<PaperworkStatus, string> = {
  not_required: 'No documents needed',
  awaiting_docs: 'Waiting on documents',
  under_review: 'Documents under review',
  needs_correction: 'Documents need fixing',
  permit_pending: 'Permit applied for',
  cleared: 'Permit issued',
  denied: 'Permit refused',
};

/** Plain English for the money track. */
const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  deposit_paid: 'Deposit paid',
  balance_due: 'Balance due',
  paid_in_full: 'Paid in full',
  refunded: 'Refunded',
  lapsed: 'Payment lapsed',
};

@Component({
  selector: 'app-admin-bookings',
  standalone: true,
  imports: [DatePipe, FormsModule, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Bookings</h1>
        <p>{{ shown().length }} shown · {{ peso(shownReceived()) }} received (deposits only until a balance is paid)</p>
      </div>
      <button type="button" class="tba-btn" (click)="exportCsv()" [disabled]="!shown().length">
        <ion-icon name="download-outline"></ion-icon>Export CSV
      </button>
    </div>

    @if (needsYou(); as n) {
      <div class="needs-you" role="status">
        <ion-icon name="alert-circle-outline"></ion-icon>
        <span><b>{{ n }}</b> {{ n === 1 ? 'booking is' : 'bookings are' }} waiting on you.</span>
        <button type="button" class="tba-btn sm" (click)="filter.set('pending')">Show them</button>
      </div>
    }

    <div class="tba-toolbar">
      <label class="tba-filter">
        <ion-icon name="search-outline"></ion-icon>
        <input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Reference, trail or hiker" />
      </label>
      <div class="tba-chips">
        @for (f of filters; track f.id) {
          <button type="button" [class.on]="filter() === f.id" (click)="filter.set(f.id)">
            {{ f.label }}<em>{{ counts()[f.id] }}</em>
          </button>
        }
      </div>
      <select class="pkg" [ngModel]="pkg()" (ngModelChange)="pkg.set($event)" aria-label="Package">
        <option value="">All packages</option>
        @for (p of packages(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
      </select>
    </div>

    <div class="tba-card flush">
      @if (shown().length) {
        <div class="tba-table-wrap">
          <table class="tba-table">
            <thead>
              <tr>
                <th>Where it stands</th><th>Trail</th><th class="hide-sm">Booking</th><th class="hide-sm">Hiker</th><th class="hide-sm">Hike date</th>
                <th class="hide-sm">Package</th><th class="num">Received</th>
              </tr>
            </thead>
            <tbody>
              @for (b of shown(); track b.id) {
                <tr class="click" [class.hl]="waitingOn(b)" (click)="open(b)">
                  <td>
                    <span class="tba-badge" [attr.data-tone]="tone(b)">{{ label(b) }}</span>
                    <small class="sub" [class.warn]="waitingOn(b)">{{ waitingOn(b) ?? PAYMENT_LABEL[b.payment] }}</small>
                  </td>
                  <td>
                    <div class="tba-who">
                      <img class="tba-thumb" [src]="b.trailImage" alt="" (error)="hideImg($event)" />
                      <div><b>{{ b.trailName }}</b></div>
                    </div>
                  </td>
                  <td class="hide-sm"><b class="ref">#{{ b.reference }}</b><small class="sub">{{ b.createdAt | date: 'MMM d, h:mm a' }}</small></td>
                  <td class="hide-sm"><div class="tba-who"><div><b>{{ b.userName || '—' }}</b><small>{{ b.userEmail }}</small></div></div></td>
                  <td class="muted hide-sm">{{ hikeDate(b) | date: 'MMM d, y' }}</td>
                  <td class="muted hide-sm">{{ b.packageName }}</td>
                  <td class="num">
                    {{ peso(receivedFrom(b)) }}
                    @if (b.deposit < b.total && b.payment !== 'paid_in_full') {
                      <small class="sub">of {{ peso(b.total) }}</small>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="mobile-bookings">
          @for (b of shown(); track b.id) {
            <details class="mobile-booking">
              <summary>
                <span class="tba-badge" [attr.data-tone]="tone(b)">{{ label(b) }}</span>
                <span class="mobile-booking__summary">
                  <b>{{ b.trailName }}</b>
                  <small>#{{ b.reference }} · {{ waitingOn(b) ?? PAYMENT_LABEL[b.payment] }}</small>
                </span>
              </summary>
              <dl>
                <div><dt>Hiker</dt><dd>{{ b.userName || '—' }}</dd></div>
                <div><dt>Email</dt><dd>{{ b.userEmail || '—' }}</dd></div>
                <div><dt>Hike date</dt><dd>{{ hikeDate(b) | date: 'MMM d, y' }}</dd></div>
                <div><dt>Package</dt><dd>{{ b.packageName }}</dd></div>
                <div><dt>Received</dt><dd>{{ peso(receivedFrom(b)) }} of {{ peso(b.total) }}</dd></div>
              </dl>
              <button type="button" class="tba-btn sm" (click)="open(b)">View booking details</button>
            </details>
          }
        </div>
      } @else {
        <div class="tba-empty">
          <ion-icon name="receipt-outline"></ion-icon>
          <h3>{{ data.bookings().length ? 'No bookings match' : 'No bookings yet' }}</h3>
          <p>{{ data.bookings().length ? 'Try another search or filter.' : 'When a hiker pays for a hike in the app, it appears here.' }}</p>
        </div>
      }
    </div>

    @if (selected(); as b) {
      <div class="tba-drawer-wrap" (click)="close()">
        <aside class="tba-drawer" (click)="$event.stopPropagation()">
          <header>
            <img class="hero" [src]="b.trailImage" alt="" (error)="hideImg($event)" />
            <div>
              <h2>#{{ b.reference }}</h2>
              <p>{{ b.trailName }}</p>
              <span class="tba-badge" [attr.data-tone]="tone(b)">{{ label(b) }}</span>
            </div>
            <button type="button" class="tba-icon-btn" aria-label="Close" (click)="close()"><ion-icon name="close-outline"></ion-icon></button>
          </header>
          <div class="tba-drawer-body">
            @if (waitingOn(b); as w) {
              <p class="next-up"><ion-icon name="hourglass-outline"></ion-icon>{{ w }}</p>
            }

            <p class="tba-section-title">Hike</p>
            <dl class="tba-dl">
              <div><dt>Hike date</dt><dd>{{ hikeDate(b) | date: 'EEEE, MMM d, y' }}</dd></div>
              <div><dt>Package</dt><dd>{{ b.packageName }}</dd></div>
              <div><dt>Activities</dt><dd>{{ b.activityNames.length ? b.activityNames.join(', ') : 'None' }}</dd></div>
              <div><dt>Guide</dt><dd>{{ b.guideName ?? 'No preference' }}</dd></div>
              @if (b.groupHikers.length) {
                <div><dt>Group size</dt><dd>{{ b.groupHikers.length }} hikers</dd></div>
              }
              @if (data.isClosed(b.trailId)) {
                <div><dt>Trail</dt><dd class="bad">Closed right now</dd></div>
              }
            </dl>
            @if (b.groupHikers.length) {
              <p class="tba-section-title gap">Group hikers &amp; emergency contacts</p>
              @for (hiker of b.groupHikers; track $index) {
                <dl class="tba-dl">
                  <div><dt>Hiker {{ $index + 1 }}</dt><dd>{{ hiker.name }}</dd></div>
                  <div><dt>Address</dt><dd>{{ hiker.address }}</dd></div>
                  <div><dt>Emergency contact</dt><dd>{{ hiker.emergencyContactName }} · {{ hiker.emergencyContactPhone }}</dd></div>
                </dl>
              }
            }

            <p class="tba-section-title gap">Hiker</p>
            <dl class="tba-dl">
              <div><dt>Name</dt><dd>{{ b.userName || '—' }}</dd></div>
              <div><dt>Email</dt><dd>{{ b.userEmail || '—' }}</dd></div>
              <div>
                <dt>Risk agreement</dt>
                <dd [class.bad]="!b.riskAckAt">
                  {{ b.riskAckAt ? (b.riskAckAt | date: 'MMM d, y, h:mm a') : 'Not on record' }}
                </dd>
              </div>
            </dl>
            @if (b.uid) {
              <button type="button" class="tba-btn sm" (click)="openHiker(b.uid)"><ion-icon name="person-outline"></ion-icon>Open hiker profile</button>
            }

            <!-- ── documents & permit ──────────────────────────────────── -->
            <p class="tba-section-title gap">Documents &amp; permit</p>
            <dl class="tba-dl">
              <div><dt>Stage</dt><dd>{{ PAPERWORK_LABEL[b.paperwork] }}</dd></div>
              <div><dt>Issuing office</dt><dd>{{ b.permitOffice ?? 'None required' }}</dd></div>
              @if (b.permitRef) {
                <div><dt>Permit no.</dt><dd class="mono">{{ b.permitRef }}</dd></div>
                <div><dt>Issued</dt><dd>{{ b.permitIssuedAt | date: 'MMM d, y' }}</dd></div>
              }
            </dl>
            @if (b.permitOffice && b.paperwork !== 'cleared' && b.paperwork !== 'denied' && b.status !== 'cancelled') {
              <div class="acts">
                @if (!b.permitLodged) {
                  <button type="button" class="tba-btn sm" [disabled]="busy()" (click)="lodge(b)">
                    <ion-icon name="ribbon-outline"></ion-icon>Mark application sent
                  </button>
                }
                <button type="button" class="tba-btn sm primary" [disabled]="busy()" (click)="recordPermit(b)">
                  <ion-icon name="document-text-outline"></ion-icon>Record issued permit
                </button>
                <button type="button" class="tba-btn sm danger" [disabled]="busy()" (click)="denyPermit(b)">
                  Office refused it
                </button>
              </div>
              <p class="hint">
                TrailBound does not issue permits — it records what {{ b.permitOffice }} issued.
                Type their reference number exactly as it appears on the document.
              </p>
            }

            <!-- ── payment ─────────────────────────────────────────────── -->
            <p class="tba-section-title gap">Payment</p>
            <dl class="tba-dl">
              <div>
                <dt>Stage</dt>
                <dd>{{ b.demoBalancePaid ? 'Balance submitted' : PAYMENT_LABEL[b.payment] }}</dd>
              </div>
              @for (m of b.merch; track m.id) {
                <div><dt>{{ m.name }} × {{ m.qty }}</dt><dd>{{ peso(m.lineTotal) }}</dd></div>
              }
              @if (b.groupSurcharge) {
                <div><dt>Group participant surcharge</dt><dd>{{ peso(b.groupSurcharge) }}</dd></div>
              }
              <div><dt>Deposit paid</dt><dd>{{ peso(b.deposit) }}</dd></div>
              <div>
                <dt>Balance</dt>
                <dd>
                  {{ b.demoBalancePaid ? 'Submitted' : b.payment === 'paid_in_full' ? 'Settled' : peso(b.total - b.deposit) }}
                  @if (b.balanceDueBy && b.payment === 'balance_due') {
                    <small class="sub">due {{ b.balanceDueBy | date: 'MMM d, y' }}</small>
                  }
                </dd>
              </div>
              <div>
                <dt>Method</dt>
                <dd>
                  {{ b.demoBalancePaid ? (b.demoBalancePaymentMethod ?? 'Payment method') : b.paymentMethod + (b.cardLast4 ? ' •••• ' + b.cardLast4 : '') }}
                </dd>
              </div>
              @if (b.demoBalancePaid) {
                <div><dt>Payment note</dt><dd>Test transaction — no funds were collected. Excluded from received-payment totals.</dd></div>
              }
              <div><dt>Booked on</dt><dd>{{ b.createdAt | date: 'MMM d, y, h:mm a' }}</dd></div>
              @if (b.updatedAt) { <div><dt>Last changed</dt><dd>{{ b.updatedAt | date: 'MMM d, y, h:mm a' }}</dd></div> }
              <div class="total"><dt>Total</dt><dd>{{ peso(b.total) }}</dd></div>
            </dl>
          </div>
          <footer>
            @if (b.status === 'pending') {
              <button type="button" class="tba-btn primary" [disabled]="busy() || !canConfirm(b)" (click)="confirmBooking(b)">
                <ion-icon name="checkmark-outline"></ion-icon>Confirm booking
              </button>
              @if (!canConfirm(b)) { <p class="gate">{{ blockedReason(b) }}</p> }
              <button type="button" class="tba-btn danger" [disabled]="busy()" (click)="cancel(b)"><ion-icon name="close-circle-outline"></ion-icon>Cancel booking</button>
            } @else if (b.status === 'cancelled' || b.status === 'no_show') {
              <button type="button" class="tba-btn" [disabled]="busy()" (click)="setStatus(b, 'confirmed')"><ion-icon name="refresh-outline"></ion-icon>Restore booking</button>
            } @else {
              @if (effectiveStatus(b) === 'completed') {
                <button type="button" class="tba-btn" [disabled]="busy()" (click)="setStatus(b, 'confirmed')"><ion-icon name="refresh-outline"></ion-icon>Mark upcoming</button>
              } @else {
                <button type="button" class="tba-btn primary" [disabled]="busy()" (click)="setStatus(b, 'completed')"><ion-icon name="checkmark-done-outline"></ion-icon>Mark completed</button>
                <button type="button" class="tba-btn" [disabled]="busy()" (click)="setStatus(b, 'no_show')">Mark no-show</button>
              }
              <button type="button" class="tba-btn danger" [disabled]="busy()" (click)="cancel(b)"><ion-icon name="close-circle-outline"></ion-icon>Cancel booking</button>
            }
            <button type="button" class="tba-btn danger icon-only" [disabled]="busy()" (click)="remove(b)" aria-label="Delete booking" title="Delete booking"><ion-icon name="trash-outline"></ion-icon></button>
          </footer>
        </aside>
      </div>
    }
  `,
  styles: [`
    .flush { padding: 8px 8px 4px; }
    .show-sm { display: none !important; }
    .mobile-bookings { display: none; }
    .mobile-booking { padding: 12px; border-top: 1px solid var(--tba-line); }
    .mobile-booking summary { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; list-style: none; }
    .mobile-booking summary::-webkit-details-marker { display: none; }
    .mobile-booking__summary { display: grid; min-width: 0; gap: 4px; }
    .mobile-booking__summary b { overflow-wrap: anywhere; }
    .mobile-booking__summary small { color: var(--tba-muted); line-height: 1.4; }
    .mobile-booking dl { display: grid; gap: 8px; margin: 12px 0; }
    .mobile-booking dl > div { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
    .mobile-booking dt { color: var(--tba-muted); }
    .mobile-booking dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
    @media (max-width: 899px) {
      .show-sm { display: block !important; }
      .tba-table-wrap { display: none; }
      .mobile-bookings { display: block; }
    }
    .flush .tba-table th:first-child, .flush .tba-table td:first-child { padding-left: 14px; }
    .ref { display: block; font-weight: 600; }
    .sub { display: block; color: var(--tba-muted); font-size: 12px; margin-top: 2px; white-space: nowrap; }
    .sub.warn { color: var(--tba-amber); }
    .pkg { height: 40px; border: 1px solid var(--tba-line); border-radius: 999px; padding: 0 14px; background: #fff; font-size: 13px; color: var(--tba-text); }
    .hero { width: 56px; height: 56px; border-radius: 14px; object-fit: cover; flex: none; background: var(--tba-sage); }
    header .tba-badge { margin-top: 8px; }
    .gap { margin-top: 22px !important; }
    .total dt { color: var(--tba-text) !important; font-weight: 700; }
    .total dd { font-size: 16px; font-weight: 700 !important; }
    .tba-drawer > footer { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .tba-drawer > footer .tba-btn { width: 100%; min-width: 0; height: auto; min-height: 40px; padding: 8px 10px; white-space: normal; line-height: 1.25; }
    .tba-drawer > footer .tba-btn.icon-only { width: 40px; min-width: 40px; justify-self: end; margin-left: 0; padding: 0; }

    /* the banner above the list */
    .needs-you { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding: 10px 14px;
      border: 1px solid var(--tba-line); border-radius: 12px; background: var(--tba-sand-soft); font-size: 14px; }
    .needs-you .tba-btn { margin-left: auto; }

    /* what the open booking is waiting for */
    .next-up { display: flex; align-items: center; gap: 8px; margin: 0 0 18px; padding: 10px 12px;
      border-radius: 10px; background: var(--tba-sand-soft); font-size: 13px; font-weight: 600; }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .hint { margin: 10px 0 0; font-size: 12px; line-height: 1.5; color: var(--tba-muted); }
    .mono { font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
    .bad { color: var(--tba-down) !important; font-weight: 600; }
    footer .gate { grid-column: 1 / -1; margin: 0; font-size: 12px; color: var(--tba-amber); }
    .tba-btn[disabled] { opacity: .5; cursor: not-allowed; }
  `],
})
export class AdminBookingsPage {
  readonly data = inject(AdminDataService);
  private readonly catalog = inject(CatalogService);
  private readonly ui = inject(AdminUiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly packages = this.catalog.packages;
  readonly filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'awaiting_confirmation', label: 'Awaiting confirmation' },
    { id: 'confirmed', label: 'Upcoming' },
    { id: 'completed', label: 'Completed' },
    { id: 'cancelled', label: 'Cancelled' },
  ];

  readonly q = signal('');
  readonly filter = signal<Filter>('all');
  readonly pkg = signal('');
  readonly busy = signal(false);
  private readonly openId = signal<string | null>(null);

  private readonly params = toSignal(this.route.queryParamMap);

  // Exposed to the template.
  readonly peso = peso;
  readonly effectiveStatus = effectiveStatus;
  readonly receivedFrom = receivedFrom;
  readonly PAPERWORK_LABEL = PAPERWORK_LABEL;
  readonly PAYMENT_LABEL = PAYMENT_LABEL;

  readonly counts = computed(() => {
    const c: Record<Filter, number> =
      {
        all: 0,
        pending: 0,
        awaiting_confirmation: 0,
        confirmed: 0,
        completed: 0,
        cancelled: 0,
        no_show: 0,
      };
    for (const b of this.data.bookings()) {
      c.all++;
      const status = effectiveStatus(b);
      c[status]++;
      if (status === 'pending' && this.canConfirm(b)) c.awaiting_confirmation++;
    }
    return c;
  });

  readonly shown = computed(() => {
    const f = this.filter();
    const q = this.q();
    const pkg = this.pkg();
    return this.data.bookings().filter(
      (b) =>
        (f === 'all'
          || (f === 'awaiting_confirmation'
            ? effectiveStatus(b) === 'pending' && this.canConfirm(b)
            : effectiveStatus(b) === f)) &&
        (!pkg || b.packageId === pkg) &&
        matches(q, b.reference, b.trailName, b.userName, b.userEmail),
    );
  });

  /**
   * What has actually been received, not what was quoted. A pending booking
   * has paid a deposit only, so counting its full price here would overstate
   * the books by whatever has not been collected yet.
   */
  readonly shownReceived = computed(() =>
    this.shown().filter(countsAsRevenue).reduce((s, b) => s + receivedFrom(b), 0),
  );

  /** Pending bookings where the next move is TrailBound's, not the hiker's. */
  readonly needsYou = computed(
    () => this.data.bookings().filter((b) => b.status === 'pending' && this.oursToMove(b)).length,
  );

  readonly selected = computed(() => {
    const id = this.openId();
    return id ? this.data.bookings().find((b) => b.id === id) ?? null : null;
  });

  constructor() {
    addIcons({
      alertCircleOutline, checkmarkDoneOutline, checkmarkOutline, closeCircleOutline, closeOutline,
      documentTextOutline, downloadOutline, hourglassOutline, personOutline,
      receiptOutline, refreshOutline, ribbonOutline, searchOutline, trashOutline,
    });
    // ?open=<id> from search, the dashboard or the activity list; ?q= to prefill.
    effect(() => {
      const p = this.params();
      if (!p) return;
      untracked(() => {
        if (p.get('q')) this.q.set(p.get('q')!);
        this.openId.set(p.get('open'));
      });
    }, { allowSignalWrites: true });
  }

  /** Opens the selected record or detail view and supplies the data it needs. */
  open(b: AdminBooking): void {
    this.openId.set(b.id);
  }

  /** Closes the active view and restores the surrounding page state. */
  close(): void {
    this.openId.set(null);
    if (this.route.snapshot.queryParamMap.has('open')) {
      this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  /** Opens the hiker detail view for the selected record. */
  openHiker(uid: string): void {
    this.router.navigate(['/admin/hikers'], { queryParams: { open: uid } });
  }

  /** Performs the hike date operation for this feature and returns its result to the caller. */
  hikeDate(b: AdminBooking): Date | null {
    return b.date ? fromDayKey(b.date) : null;
  }

  /** Maps an internal value to the readable label shown in the interface. */
  label(b: AdminBooking): string {
    switch (effectiveStatus(b)) {
      case 'pending': return this.canConfirm(b) ? 'Awaiting confirmation' : 'Pending';
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      case 'no_show': return 'No show';
      default: return 'Upcoming';
    }
  }

  /** Maps a status value to the visual style used by the interface. */
  tone(b: AdminBooking): string {
    switch (effectiveStatus(b)) {
      case 'pending': return 'amber';
      case 'completed': return 'ink';
      case 'cancelled':
      case 'no_show': return 'red';
      default: return 'green';
    }
  }

  /**
   * One line naming what the booking is actually waiting for, in the order a
   * booking moves. Null once nothing is outstanding.
   */
  waitingOn(b: AdminBooking): string | null {
    if (b.status !== 'pending') return null;
    switch (b.paperwork) {
      case 'awaiting_docs': return 'Waiting on the hiker to upload a medical certificate';
      case 'under_review': return 'Medical certificate waiting for review';
      case 'needs_correction': return 'Hiker needs to re-upload a document';
      case 'denied': return 'Permit refused — needs cancelling and a refund';
      case 'permit_pending': return `Waiting on ${b.permitOffice ?? 'the permit office'}`;
      default: break;
    }
    if (b.permitOffice && !b.permitLodged && b.paperwork !== 'cleared') {
      return `Permit application not sent to ${b.permitOffice} yet`;
    }
    if (this.canConfirm(b)) return 'Waiting for booking confirmation';
    if (b.payment === 'balance_due') return 'Waiting on the balance payment';
    if (b.payment === 'lapsed') return 'Balance went unpaid past its due date';
    return 'Waiting on the permit';
  }

  /** True when TrailBound is holding things up, rather than the hiker or the office. */
  private oursToMove(b: AdminBooking): boolean {
    if (b.paperwork === 'under_review' || b.paperwork === 'denied') return true;
    if (b.permitOffice && !b.permitLodged && b.paperwork !== 'cleared') return true;
    return this.canConfirm(b);
  }

  /** Both tracks have to be finished. Nothing else confirms a hike. */
  canConfirm(b: AdminBooking): boolean {
    const docsDone = b.paperwork === 'cleared' || b.paperwork === 'not_required';
    return docsDone && (b.payment === 'paid_in_full' || b.demoBalancePaid);
  }

  /** Performs the blocked reason operation for this feature and returns its result to the caller. */
  blockedReason(b: AdminBooking): string {
    const docsDone = b.paperwork === 'cleared' || b.paperwork === 'not_required';
    const why = docsDone ? PAYMENT_LABEL[b.payment] : PAPERWORK_LABEL[b.paperwork];
    return `Cannot confirm yet — ${why.toLowerCase()}.`;
  }

  // ── permit workflow ──────────────────────────────────────────────────────

  /** Marks the application as sent, which is what makes it visible to the office. */
  async lodge(b: AdminBooking): Promise<void> {
    const office = b.permitOffice;
    if (!office) return;
    const ok = await this.ui.confirm({
      title: 'Mark application sent',
      message: `Record that the permit application for ${b.trailName} has gone to ${office}. The hiker's tracker will show it as being arranged.`,
      confirmText: 'Mark sent',
    });
    if (!ok) return;
    await this.run(() => this.data.lodgePermit(b.id, office), 'Application marked as sent');
  }

  /**
   * Records the issued permit. This is the write the whole flow turns on: it
   * clears the paperwork track and makes the balance payable.
   */
  async recordPermit(b: AdminBooking): Promise<void> {
    const office = b.permitOffice ?? '';
    const ref = await this.ui.ask({
      title: `Record permit for #${b.reference}`,
      message: `Type the reference number exactly as ${office || 'the issuing office'} wrote it. The hiker will see it on their booking, and the balance of ${peso(b.total - b.deposit)} becomes payable.`,
      confirmText: 'Record permit',
      input: { label: 'Permit reference number', placeholder: 'e.g. PAMO-2026-01847' },
    });
    if (ref === null) return;
    if (!ref.trim()) {
      this.ui.toast('A permit needs its reference number', 'error');
      return;
    }
    await this.run(() => this.data.recordPermit(b.id, ref, office), 'Permit recorded — balance is now due');
  }

  /** The office refused it, so the hike cannot go ahead. */
  async denyPermit(b: AdminBooking): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Permit refused',
      message: `Record that ${b.permitOffice ?? 'the office'} refused this permit. Cancel the booking next to work out the refund — the hiker should not be left paying for a hike that cannot happen.`,
      confirmText: 'Record refusal',
      danger: true,
    });
    if (!ok) return;
    await this.run(() => this.data.denyPermit(b.id), 'Refusal recorded');
  }

  /** Performs the confirm booking operation for this feature and returns its result to the caller. */
  async confirmBooking(b: AdminBooking): Promise<void> {
    if (!this.canConfirm(b)) return;
    const paymentNote = b.demoBalancePaid
      ? 'The balance was submitted as a test transaction; no funds were collected.'
      : 'Their permit and payment are both on record.';
    const ok = await this.ui.confirm({
      title: `Confirm #${b.reference}?`,
      message: `${b.userName || 'The hiker'} is ready for ${b.trailName}. ${paymentNote} Confirming will update their booking tracker.`,
      confirmText: 'Confirm booking',
    });
    if (!ok) return;
    await this.run(() => this.data.setBookingStatus(b.id, 'confirmed'), 'Booking confirmed');
  }

  // ── status ───────────────────────────────────────────────────────────────

  /** Updates the selected record status through the owning service. */
  async setStatus(b: AdminBooking, status: BookingStatus): Promise<void> {
    const said =
      status === 'completed' ? 'Marked as completed'
      : status === 'no_show' ? 'Marked as a no-show'
      : 'Booking is active again';
    await this.run(() => this.data.setBookingStatus(b.id, status), said);
  }

  /** Checks whether the booking can be cancelled from its current status. */
  async cancel(b: AdminBooking): Promise<void> {
    const paid = peso(receivedFrom(b));
    const ok = await this.ui.confirm({
      title: `Cancel #${b.reference}?`,
      message: `${b.userName || 'The hiker'} will see this booking as cancelled in their Bookings tab. ${paid} has been received — work out the refund with them separately, since how much goes back depends on how close the hike date is and whether the permit fee was already lodged.`,
      confirmText: 'Cancel booking',
      danger: true,
    });
    if (!ok) return;
    await this.run(() => this.data.setBookingStatus(b.id, 'cancelled'), 'Booking cancelled');
  }

  /** Removes the selected record through the owning service and refreshes the view. */
  async remove(b: AdminBooking): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Delete #${b.reference}?`,
      message: 'This removes the booking record completely, including the record of the deposit and from the hiker’s Bookings tab. Cancelling keeps a record instead, which is almost always the right thing.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.data.deleteBooking(b.id);
      this.close();
      this.ui.toast('Booking deleted');
    } catch (e) {
      this.ui.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * One write, with the busy flag and error handling every action shares.
   *
   * The drawer reads from data.bookings() through selected(), so the live
   * snapshot re-renders it — there is nothing to refresh by hand.
   */
  private async run(write: () => Promise<void>, said: string): Promise<void> {
    this.busy.set(true);
    try {
      await write();
      this.ui.toast(said);
    } catch (e) {
      this.ui.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  // ── export ───────────────────────────────────────────────────────────────

  /** Converts the current records into a downloadable CSV export. */
  exportCsv(): void {
    const head = [
      'Reference', 'Booked on', 'Hike date', 'Trail', 'Hiker', 'Email', 'Package', 'Activities',
      'Guide', 'Status', 'Paperwork', 'Payment stage', 'Permit office', 'Permit no.',
      'Method', 'Balance submission', 'Deposit (PHP)', 'Received (PHP)', 'Total (PHP)',
    ];
    const rows = this.shown().map((b) => [
      b.reference, b.createdAt?.toISOString() ?? '', b.date, b.trailName, b.userName, b.userEmail,
      b.packageName, b.activityNames.join('; '), b.guideName ?? '',
      this.label(b), PAPERWORK_LABEL[b.paperwork],
      b.demoBalancePaid ? 'Submitted in demo checkout; no money received' : PAYMENT_LABEL[b.payment],
      b.permitOffice ?? '', b.permitRef ?? '',
      b.demoBalancePaid
        ? `${b.demoBalancePaymentMethod ?? 'Payment method'} · test transaction`
        : b.paymentMethod,
      b.demoBalancePaid ? 'Test transaction - no funds collected' : 'Not submitted',
      String(b.deposit), String(receivedFrom(b)), String(b.total),
    ]);
    const csv = [head, ...rows]
      .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `trailbound-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Performs the hide img operation for this feature and returns its result to the caller. */
  hideImg(e: Event): void {
    (e.target as HTMLImageElement).style.visibility = 'hidden';
  }
}