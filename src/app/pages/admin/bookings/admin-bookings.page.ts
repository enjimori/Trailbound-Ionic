/**
 * Bookings — every booking from every hiker. Filter, open one to see the full
 * receipt, mark it completed, cancel it, or delete it. Export to CSV.
 */
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  checkmarkDoneOutline, closeCircleOutline, closeOutline, downloadOutline, personOutline,
  receiptOutline, refreshOutline, searchOutline, trashOutline,
} from 'ionicons/icons';

import {
  AdminBooking, AdminDataService, BookingStatus, countsAsRevenue, effectiveStatus,
} from '../admin-data.service';
import { AdminUiService } from '../admin-ui.service';
import { fromDayKey, matches, peso } from '../admin-utils';
import { PACKAGES } from '../../booking/booking-catalog';

type Filter = 'all' | BookingStatus;

@Component({
  selector: 'app-admin-bookings',
  standalone: true,
  imports: [DatePipe, FormsModule, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Bookings</h1>
        <p>{{ shown().length }} shown · {{ peso(shownRevenue()) }} revenue (cancelled bookings not counted)</p>
      </div>
      <button type="button" class="tba-btn" (click)="exportCsv()" [disabled]="!shown().length">
        <ion-icon name="download-outline"></ion-icon>Export CSV
      </button>
    </div>

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
        @for (p of packages; track p.id) { <option [value]="p.id">{{ p.name }}</option> }
      </select>
    </div>

    <div class="tba-card flush">
      @if (shown().length) {
        <div class="tba-table-wrap">
          <table class="tba-table">
            <thead>
              <tr>
                <th class="hide-sm">Booking</th><th>Trail</th><th class="hide-sm">Hiker</th><th class="hide-sm">Hike date</th>
                <th class="hide-sm">Package</th><th class="hide-sm">Status</th><th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              @for (b of shown(); track b.id) {
                <tr class="click" (click)="open(b)">
                  <td class="hide-sm"><b class="ref">#{{ b.reference }}</b><small class="sub">{{ b.createdAt | date: 'MMM d, h:mm a' }}</small></td>
                  <td>
                    <div class="tba-who">
                      <img class="tba-thumb" [src]="b.trailImage" alt="" (error)="hideImg($event)" />
                      <div><b>{{ b.trailName }}</b><small class="show-sm">#{{ b.reference }} · {{ label(b) }}</small></div>
                    </div>
                  </td>
                  <td class="hide-sm"><div class="tba-who"><div><b>{{ b.userName || '—' }}</b><small>{{ b.userEmail }}</small></div></div></td>
                  <td class="muted hide-sm">{{ hikeDate(b) | date: 'MMM d, y' }}</td>
                  <td class="muted hide-sm">{{ b.packageName }}</td>
                  <td class="hide-sm"><span class="tba-badge" [attr.data-tone]="tone(b)">{{ label(b) }}</span></td>
                  <td class="num">{{ peso(b.total) }}</td>
                </tr>
              }
            </tbody>
          </table>
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
            <p class="tba-section-title">Hike</p>
            <dl class="tba-dl">
              <div><dt>Hike date</dt><dd>{{ hikeDate(b) | date: 'EEEE, MMM d, y' }}</dd></div>
              <div><dt>Package</dt><dd>{{ b.packageName }}</dd></div>
              <div><dt>Activities</dt><dd>{{ b.activityNames.length ? b.activityNames.join(', ') : 'None' }}</dd></div>
              <div><dt>Guide</dt><dd>{{ b.guideName ?? 'No preference' }}</dd></div>
            </dl>

            <p class="tba-section-title">Hiker</p>
            <dl class="tba-dl">
              <div><dt>Name</dt><dd>{{ b.userName || '—' }}</dd></div>
              <div><dt>Email</dt><dd>{{ b.userEmail || '—' }}</dd></div>
            </dl>
            @if (b.uid) {
              <button type="button" class="tba-btn sm" (click)="openHiker(b.uid)"><ion-icon name="person-outline"></ion-icon>Open hiker profile</button>
            }

            <p class="tba-section-title gap">Payment</p>
            <dl class="tba-dl">
              @for (m of b.merch; track m.id) {
                <div><dt>{{ m.name }} × {{ m.qty }}</dt><dd>{{ peso(m.lineTotal) }}</dd></div>
              }
              <div><dt>Method</dt><dd>{{ b.paymentMethod }}{{ b.cardLast4 ? ' •••• ' + b.cardLast4 : '' }}</dd></div>
              <div><dt>Booked on</dt><dd>{{ b.createdAt | date: 'MMM d, y, h:mm a' }}</dd></div>
              @if (b.updatedAt) { <div><dt>Last changed</dt><dd>{{ b.updatedAt | date: 'MMM d, y, h:mm a' }}</dd></div> }
              <div class="total"><dt>Total paid</dt><dd>{{ peso(b.total) }}</dd></div>
            </dl>
          </div>
          <footer>
            @if (b.status !== 'cancelled') {
              @if (label(b) !== 'Completed') {
                <button type="button" class="tba-btn primary" [disabled]="busy()" (click)="setStatus(b, 'completed')"><ion-icon name="checkmark-done-outline"></ion-icon>Mark completed</button>
              } @else if (b.status === 'completed') {
                <button type="button" class="tba-btn" [disabled]="busy()" (click)="setStatus(b, 'confirmed')"><ion-icon name="refresh-outline"></ion-icon>Mark upcoming</button>
              }
              <button type="button" class="tba-btn danger" [disabled]="busy()" (click)="cancel(b)"><ion-icon name="close-circle-outline"></ion-icon>Cancel booking</button>
            } @else {
              <button type="button" class="tba-btn" [disabled]="busy()" (click)="setStatus(b, 'confirmed')"><ion-icon name="refresh-outline"></ion-icon>Restore booking</button>
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
    @media (max-width: 899px) { .show-sm { display: block !important; } }
    .flush .tba-table th:first-child, .flush .tba-table td:first-child { padding-left: 14px; }
    .ref { display: block; font-weight: 600; }
    .sub { display: block; color: var(--tba-muted); font-size: 12px; margin-top: 2px; white-space: nowrap; }
    .pkg { height: 40px; border: 1px solid var(--tba-line); border-radius: 999px; padding: 0 14px; background: #fff; font-size: 13px; color: var(--tba-text); }
    .hero { width: 56px; height: 56px; border-radius: 14px; object-fit: cover; flex: none; background: var(--tba-sage); }
    header .tba-badge { margin-top: 8px; }
    .gap { margin-top: 22px !important; }
    .total dt { color: var(--tba-text) !important; font-weight: 700; }
    .total dd { font-size: 16px; font-weight: 700 !important; }
    .icon-only { margin-left: auto; width: 38px; padding: 0; }
  `],
})
export class AdminBookingsPage {
  readonly data = inject(AdminDataService);
  private readonly ui = inject(AdminUiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly packages = PACKAGES;
  readonly filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
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

  readonly counts = computed(() => {
    const c: Record<Filter, number> = { all: 0, confirmed: 0, completed: 0, cancelled: 0 };
    for (const b of this.data.bookings()) {
      c.all++;
      c[effectiveStatus(b)]++;
    }
    return c;
  });

  readonly shown = computed(() => {
    const f = this.filter();
    const q = this.q();
    const pkg = this.pkg();
    return this.data.bookings().filter(
      (b) =>
        (f === 'all' || effectiveStatus(b) === f) &&
        (!pkg || b.packageId === pkg) &&
        matches(q, b.reference, b.trailName, b.userName, b.userEmail),
    );
  });

  readonly shownRevenue = computed(() =>
    this.shown().filter(countsAsRevenue).reduce((s, b) => s + b.total, 0),
  );

  readonly selected = computed(() => {
    const id = this.openId();
    return id ? this.data.bookings().find((b) => b.id === id) ?? null : null;
  });

  constructor() {
    addIcons({
      checkmarkDoneOutline, closeCircleOutline, closeOutline, downloadOutline, personOutline,
      receiptOutline, refreshOutline, searchOutline, trashOutline,
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

  open(b: AdminBooking): void {
    this.openId.set(b.id);
  }

  close(): void {
    this.openId.set(null);
    if (this.route.snapshot.queryParamMap.has('open')) {
      this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  openHiker(uid: string): void {
    this.router.navigate(['/admin/hikers'], { queryParams: { open: uid } });
  }

  hikeDate(b: AdminBooking): Date | null {
    return b.date ? fromDayKey(b.date) : null;
  }

  label(b: AdminBooking): string {
    const s = effectiveStatus(b);
    return s === 'cancelled' ? 'Cancelled' : s === 'completed' ? 'Completed' : 'Upcoming';
  }

  tone(b: AdminBooking): string {
    const s = effectiveStatus(b);
    return s === 'cancelled' ? 'red' : s === 'completed' ? 'ink' : 'green';
  }

  async setStatus(b: AdminBooking, status: BookingStatus): Promise<void> {
    this.busy.set(true);
    try {
      await this.data.setBookingStatus(b.id, status);
      this.ui.toast(status === 'completed' ? 'Marked as completed' : 'Booking is active again');
    } catch (e) {
      this.ui.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  async cancel(b: AdminBooking): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Cancel #${b.reference}?`,
      message: `${b.userName || 'The hiker'} will see this booking as cancelled in their Bookings tab. Refunds are handled outside the app.`,
      confirmText: 'Cancel booking',
      danger: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.data.setBookingStatus(b.id, 'cancelled');
      this.ui.toast('Booking cancelled');
    } catch (e) {
      this.ui.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  async remove(b: AdminBooking): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Delete #${b.reference}?`,
      message: 'This removes the booking record completely, including from the hiker’s Bookings tab. Cancelling keeps a record instead.',
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

  exportCsv(): void {
    const head = ['Reference', 'Booked on', 'Hike date', 'Trail', 'Hiker', 'Email', 'Package', 'Activities', 'Guide', 'Status', 'Payment', 'Total (PHP)'];
    const rows = this.shown().map((b) => [
      b.reference, b.createdAt?.toISOString() ?? '', b.date, b.trailName, b.userName, b.userEmail, b.packageName,
      b.activityNames.join('; '), b.guideName ?? '', this.label(b), b.paymentMethod, String(b.total),
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

  hideImg(e: Event): void {
    (e.target as HTMLImageElement).style.visibility = 'hidden';
  }

  peso = peso;
}
