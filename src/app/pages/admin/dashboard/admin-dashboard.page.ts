/**
 * Admin dashboard — revenue, bookings and hikers at a glance, a revenue
 * chart, the latest bookings, and a side rail with hikers, trail status and
 * community activity.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowDown, arrowForward, arrowUp, cashOutline, peopleOutline, receiptOutline, send, trendingUp,
} from 'ionicons/icons';

import { AdminDataService, AdminBooking, countsAsRevenue, effectiveStatus } from '../admin-data.service';
import { initials, pctChange, peso, pesoShort, tintFor } from '../admin-utils';
import { summarize } from '../../../models/guide-ops.model';
import { GUIDES } from '../../booking/booking-catalog';
import { TRAILS_30 } from '../../explore/explore-trails.data';

type Period = 'week' | 'month' | 'year';
type CommunityPeriod = 'week' | 'month';

interface Bucket { label: string; now: number; before: number }

const DAY = 86_400_000;
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, IonIcon],
  template: `
    <div class="dash">
      <div class="dash-main">
        <section class="stats">
          @for (s of stats(); track s.label) {
            <div class="stat">
              <span class="stat-icon"><ion-icon [name]="s.icon"></ion-icon></span>
              <div>
                <div class="stat-top">
                  <span class="stat-label">{{ s.label }}</span>
                  @if (s.change !== null) {
                    <span class="pct" [class.down]="s.change < 0">
                      <ion-icon [name]="s.change < 0 ? 'arrow-down' : 'arrow-up'"></ion-icon>{{ abs(s.change) }}%
                    </span>
                  }
                </div>
                <strong>{{ s.value }}</strong>
                <small>{{ s.note }}</small>
              </div>
            </div>
          }
        </section>

        <section class="chart-block">
          <div class="block-head">
            <h2>Revenue</h2>
            <div class="tabs" role="tablist">
              @for (p of periods; track p.id) {
                <button type="button" role="tab" [class.on]="period() === p.id" (click)="period.set(p.id)">{{ p.label }}</button>
              }
            </div>
          </div>

          <div class="legend">
            <span><i class="sw sand"></i>{{ legend().now }}</span>
            <span><i class="sw ink"></i>{{ legend().before }}</span>
            <b>{{ peso(chartTotal()) }}</b>
          </div>

          <div class="chart" [attr.aria-label]="'Revenue by ' + period()">
            <div class="y-axis">
              @for (t of ticks(); track $index) { <span [style.bottom.%]="$index * 25">{{ t }}</span> }
            </div>
            <div class="plot">
              <div class="grid-lines">
                @for (t of ticks(); track $index) { <i [style.bottom.%]="$index * 25"></i> }
              </div>
              @for (b of buckets(); track b.label; let i = $index) {
                <div class="group" (mouseenter)="hover.set(i)" (mouseleave)="hover.set(-1)">
                  @if (hover() === i) {
                    <div class="tip">
                      <span><i class="sw sand"></i>{{ peso(b.now) }}</span>
                      <span><i class="sw ink"></i>{{ peso(b.before) }}</span>
                    </div>
                  }
                  <div class="bars">
                    <i class="bar sand" [style.height.%]="pct(b.now)"></i>
                    <i class="bar ink" [style.height.%]="pct(b.before)"></i>
                  </div>
                  <span class="x">{{ b.label }}</span>
                </div>
              }
              @if (chartTotal() === 0 && previousTotal() === 0) {
                <p class="chart-empty">No bookings in this period yet.</p>
              }
            </div>
          </div>
        </section>

        <section class="recent">
          <div class="block-head">
            <h2>Recent bookings</h2>
            <a routerLink="/admin/bookings" class="more">See all</a>
          </div>
          @if (recent().length) {
            <div class="tba-table-wrap">
              <table class="tba-table">
                <tbody>
                  @for (b of recent(); track b.id) {
                    <tr class="click" (click)="openBooking(b)">
                      <td>
                        <div class="tba-who">
                          <img class="tba-thumb" [src]="b.trailImage" alt="" (error)="hideImg($event)" />
                          <div><b>{{ b.trailName }}</b><small>{{ b.userName || b.userEmail || 'Hiker' }}</small></div>
                        </div>
                      </td>
                      <td class="muted hide-sm">{{ b.createdAt | date: 'MMM d, y' }}</td>
                      <td class="muted hide-sm">{{ b.packageName }}</td>
                      <td class="hide-sm"><span class="tba-badge" [attr.data-tone]="tone(b)">{{ statusLabel(b) }}</span></td>
                      <td class="num">{{ peso(b.total) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="tba-empty">
              <ion-icon name="receipt-outline"></ion-icon>
              <h3>No bookings yet</h3>
              <p>Bookings made in the app show up here the moment they are paid.</p>
            </div>
          }
        </section>

        <!-- Guides' attendance checklists, live from attendance/{bookingId}. -->
        <section class="recent attendance">
          <div class="block-head">
            <h2>Attendance</h2>
            <span class="att-total">
              Last 30 days: {{ attendanceTotals().present }} present, {{ attendanceTotals().absent }} absent
            </span>
          </div>
          @if (attendanceRecent().length) {
            <div class="tba-table-wrap">
              <table class="tba-table">
                <tbody>
                  @for (a of attendanceRecent(); track a.id) {
                    <tr class="click" (click)="openBookingId(a.id)">
                      <td>
                        <div class="tba-who">
                          <img class="tba-thumb" [src]="a.image" alt="" (error)="hideImg($event)" />
                          <div><b>{{ a.trail }}</b><small>#{{ a.reference }} · {{ a.hiker }}</small></div>
                        </div>
                      </td>
                      <td class="muted hide-sm">{{ a.when | date: 'MMM d, y' }}</td>
                      <td class="muted hide-sm">{{ a.guide }}</td>
                      <td class="num">
                        <span class="tba-badge" [attr.data-tone]="a.tone">{{ a.present }} of {{ a.total }} present</span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <div class="tba-empty">
              <ion-icon name="people-outline"></ion-icon>
              <h3>No attendance yet</h3>
              <p>When a guide takes attendance on the hike day, who showed up and who was absent appears here.</p>
            </div>
          }
        </section>
      </div>

      <aside class="rail">
        <section class="rail-hikers">
          <div class="block-head"><h2>Hikers</h2><a routerLink="/admin/hikers" class="more">View all</a></div>
          <div class="faces">
            @for (u of faces(); track u.uid; let first = $first) {
              <button type="button" class="face" [class.ring]="first" [title]="u.name || u.email" (click)="openHiker(u.uid)">
                @if (u.avatar) { <img [src]="u.avatar" alt="" /> }
                @else { <span [style.background]="tint(u.uid)">{{ ini(u.name || u.email) }}</span> }
              </button>
            } @empty {
              <p class="rail-note">No hikers have signed up yet.</p>
            }
            @if (extraHikers() > 0) { <a routerLink="/admin/hikers" class="face more-face">+{{ extraHikers() }}</a> }
          </div>
          <form class="find" (ngSubmit)="findHiker()">
            <input name="q" [(ngModel)]="hikerQuery" placeholder="Find a hiker…" aria-label="Find a hiker" />
            <button type="submit" aria-label="Search hikers"><ion-icon name="send"></ion-icon></button>
          </form>
        </section>

        <section class="rail-promo">
          <div>
            <p class="promo-eyebrow">Trail status</p>
            <h3>{{ openTrails() }} of {{ totalTrails }} trails open</h3>
            <p class="promo-sub">
              @if (data.closedCount()) { {{ data.closedCount() }} closed for booking right now. }
              @else { Close a trail when it is unsafe and bookings stop. }
            </p>
            <a routerLink="/admin/trails" class="promo-btn">Manage trails</a>
          </div>
          <svg class="promo-art" viewBox="0 0 120 100" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="84" cy="26" r="9" />
            <path d="M6 86 L38 40 L52 58 L70 30 L104 86 Z" />
            <path d="M38 40 L44 50 L36 52" />
            <path d="M70 30 L77 42 L68 44" />
            <path d="M48 86 C54 76 62 76 58 66 C55 60 62 58 66 54" stroke-dasharray="2 4" />
            <path d="M20 18 l0 6 M17 21 l6 0" /><path d="M108 52 l0 5 M105.5 54.5 l5 0" /><circle cx="60" cy="12" r="1.2" />
          </svg>
        </section>

        <section class="rail-analytics">
          <div class="block-head">
            <h2>Community</h2>
            <select [ngModel]="cPeriod()" (ngModelChange)="cPeriod.set($event)" aria-label="Period">
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </div>
          <p class="growth" [class.down]="(community().change ?? 0) < 0">
            <ion-icon name="trending-up"></ion-icon>
            @if (community().change !== null) { {{ community().change! > 0 ? '+' : '' }}{{ community().change }}% posts }
            @else { New activity }
            <span>vs previous {{ cPeriod() }}</span>
          </p>
          <div class="diverge">
            @for (b of community().buckets; track $index) {
              <div class="dv" [title]="b.label + ': ' + b.posts + ' posts, ' + b.reviews + ' reviews'">
                <span class="up"><i [style.height.%]="dpct(b.posts)"></i></span>
                <span class="down"><i [style.height.%]="dpct(b.reviews)"></i></span>
              </div>
            }
          </div>
          <div class="legend small">
            <span><i class="sw ink"></i>Posts {{ community().posts }}</span>
            <span><i class="sw sand"></i>Reviews {{ community().reviews }}</span>
          </div>
        </section>
      </aside>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .dash { display: grid; grid-template-columns: minmax(0, 1fr) var(--tba-rail); min-height: 100%; }
    .dash-main { padding: 26px 32px 40px; min-width: 0; }
    h2 { font-size: 19px; font-weight: 700; }
    .block-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .more { font-size: 13px; font-weight: 600; text-decoration: underline !important; text-underline-offset: 3px; }

    .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding-bottom: 24px; border-bottom: 1px solid var(--tba-line); }
    .stat { display: flex; gap: 14px; padding: 4px 22px; border-left: 1px dashed #dcdcd5; min-width: 0; }
    .stat:first-child { border-left: 0; padding-left: 0; }
    .stat-icon { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; background: var(--tba-sage); font-size: 20px; flex: none; }
    .stat:nth-child(2) .stat-icon { background: var(--tba-sand-soft); }
    .stat:nth-child(3) .stat-icon { background: #eef0f6; }
    .stat-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .stat-label { font-size: 13px; color: var(--tba-muted); }
    .stat strong { display: block; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin-top: 2px; white-space: nowrap; }
    .stat small { display: block; font-size: 12px; color: var(--tba-muted); margin-top: 2px; }
    .pct { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 600; color: var(--tba-up); }
    .pct.down { color: var(--tba-down); }

    .chart-block { padding: 24px 0 26px; border-bottom: 1px solid var(--tba-line); }
    .tabs { display: flex; gap: 18px; }
    .tabs button { border: 0; background: none; padding: 4px 0; font-size: 13px; font-weight: 600; color: var(--tba-faint); border-bottom: 2px solid transparent; }
    .tabs button.on { color: var(--tba-text); border-color: var(--tba-text); }
    .legend { display: flex; align-items: center; gap: 18px; font-size: 12.5px; color: var(--tba-muted); margin: -2px 0 14px; }
    .legend b { margin-left: auto; color: var(--tba-text); font-size: 14px; }
    .legend.small { font-size: 12px; margin: 12px 0 0; gap: 14px; }
    .sw { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 6px; vertical-align: 0; }
    .sw.sand { background: var(--tba-sand); }
    .sw.ink { background: var(--tba-ink); }

    .chart { display: flex; gap: 12px; height: 240px; }
    .y-axis { position: relative; margin-bottom: 26px; font-size: 11.5px; color: var(--tba-muted); min-width: 40px; }
    .y-axis span { position: absolute; right: 0; transform: translateY(50%); line-height: 1; white-space: nowrap; }
    .plot { position: relative; flex: 1; display: flex; align-items: stretch; padding-bottom: 26px; }
    .grid-lines { position: absolute; left: 0; right: 0; top: 0; bottom: 26px; pointer-events: none; }
    .grid-lines i { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed #e6e6df; }
    .group { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; }
    .bars { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 5px; position: relative; z-index: 1; }
    .bar { width: min(12px, 28%); border-radius: 4px 4px 2px 2px; min-height: 2px; transition: height .35s ease; }
    .bar.sand { background: var(--tba-sand); }
    .bar.ink { background: var(--tba-ink); }
    .group:hover .bars { background: rgba(29,36,32,.03); border-radius: 8px; }
    .x { position: absolute; bottom: -24px; font-size: 11px; color: var(--tba-muted); letter-spacing: .04em; }
    .tip { position: absolute; bottom: calc(100% - 8px); z-index: 3; background: var(--tba-ink); color: #fff; border-radius: 10px; padding: 7px 10px; font-size: 11.5px; white-space: nowrap; display: grid; gap: 3px; box-shadow: 0 8px 20px rgba(0,0,0,.15); }
    .chart-empty { position: absolute; inset: 0 0 26px; display: grid; place-items: center; margin: 0; color: var(--tba-muted); font-size: 13px; }

    .recent { padding-top: 24px; }
    .recent.attendance { padding-top: 28px; }
    .att-total { color: var(--tba-muted); font-size: 12.5px; }
    .recent .tba-table td:first-child { padding-left: 0; }
    .recent .tba-table td:last-child { padding-right: 0; }
    .recent .tba-table tr:first-child td { border-top: 0; }

    .rail { background: var(--tba-cream); display: flex; flex-direction: column; }
    .rail section { padding: 24px 28px; }
    .faces { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-bottom: 18px; }
    .face { width: 44px; height: 44px; border-radius: 50%; padding: 0; border: 0; overflow: hidden; display: grid; place-items: center; background: #fff; font-size: 13px; font-weight: 700; }
    .face img, .face span { width: 100%; height: 100%; object-fit: cover; display: grid; place-items: center; }
    .face.ring { box-shadow: 0 0 0 2px var(--tba-cream), 0 0 0 4px var(--tba-sand); }
    .more-face { background: rgba(29,36,32,.07); font-size: 12px; }
    .rail-note { margin: 0; font-size: 13px; color: var(--tba-muted); }
    .find { display: flex; align-items: center; gap: 6px; height: 50px; padding: 0 6px 0 18px; border-radius: 999px; background: #f1ead9; }
    .find input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font-size: 13.5px; color: var(--tba-text); }
    .find input::placeholder { color: #a39e8f; }
    .find button { width: 38px; height: 38px; border-radius: 50%; border: 0; background: var(--tba-ink); color: #fff; display: grid; place-items: center; font-size: 15px; }

    .rail-promo { position: relative; background: var(--tba-ink); color: #fff; display: flex; gap: 12px; overflow: hidden; }
    .rail-promo > div { position: relative; z-index: 1; }
    .promo-eyebrow { margin: 0; font-size: 12px; color: rgba(255,255,255,.6); }
    .rail-promo h3 { color: #fff; font-size: 19px; font-weight: 700; margin: 4px 0 6px; }
    .promo-sub { margin: 0 0 16px; max-width: 62%; font-size: 12.5px; line-height: 1.45; color: rgba(255,255,255,.72); }
    .promo-btn { display: inline-flex; height: 38px; align-items: center; padding: 0 20px; border-radius: 999px; background: #fff; color: var(--tba-ink) !important; font-size: 13px; font-weight: 600; }
    .promo-art { position: absolute; right: 14px; bottom: 14px; width: 112px; color: rgba(255,255,255,.85); }

    .rail-analytics { flex: 1; background: var(--tba-sage); }
    .rail-analytics select { border: 0; background: none; font-size: 13px; font-weight: 600; color: var(--tba-text); cursor: pointer; }
    .growth { display: flex; align-items: center; gap: 6px; margin: -6px 0 16px; font-size: 12.5px; font-weight: 600; color: var(--tba-up); flex-wrap: wrap; }
    .growth.down { color: var(--tba-down); }
    .growth span { color: var(--tba-muted); font-weight: 500; }
    .diverge { display: flex; justify-content: space-between; gap: 6px; height: 190px; }
    .dv { flex: 1; display: flex; flex-direction: column; align-items: center; }
    .dv .up, .dv .down { flex: 1; width: 100%; display: flex; justify-content: center; }
    .dv .up { align-items: flex-end; padding-bottom: 2px; }
    .dv .down { align-items: flex-start; padding-top: 2px; }
    .dv i { width: 7px; border-radius: 6px; min-height: 4px; }
    .dv .up i { background: var(--tba-ink); }
    .dv .down i { background: var(--tba-sand); }

    @media (max-width: 1399px) {
      .stat strong { font-size: 22px; }
      .stat { padding: 4px 14px; }
    }
    @media (max-width: 1199px) {
      .dash { grid-template-columns: 1fr; }
      .rail { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; padding: 0 32px 40px; background: none; }
      .rail section { border-radius: 20px; }
      .rail-hikers { background: var(--tba-cream); }
    }
    @media (max-width: 899px) {
      .dash-main { padding: 18px 16px 30px; }
      .rail { padding: 0 16px 32px; }
      .stats { grid-template-columns: 1fr; gap: 16px; }
      .stat, .stat:first-child { border-left: 0; padding: 0; }
      .chart { height: 200px; }
    }
  `],
})
export class AdminDashboardPage {
  readonly data = inject(AdminDataService);
  private readonly router = inject(Router);

  readonly periods: { id: Period; label: string }[] = [
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
    { id: 'year', label: 'Year' },
  ];
  readonly period = signal<Period>('week');
  readonly cPeriod = signal<CommunityPeriod>('week');
  readonly hover = signal(-1);
  hikerQuery = '';

  readonly totalTrails = TRAILS_30.length;
  readonly openTrails = computed(() => this.totalTrails - this.data.closedCount());

  private readonly paid = computed(() => this.data.bookings().filter(countsAsRevenue));

  readonly stats = computed(() => {
    const now = Date.now();
    const inWindow = (b: AdminBooking, from: number, to: number) => {
      const t = b.createdAt?.getTime() ?? 0;
      return t >= from && t < to;
    };
    const paid = this.paid();
    const last30 = paid.filter((b) => inWindow(b, now - 30 * DAY, now + DAY));
    const prev30 = paid.filter((b) => inWindow(b, now - 60 * DAY, now - 30 * DAY));
    const sum = (list: AdminBooking[]) => list.reduce((s, b) => s + b.total, 0);

    const hikers = this.data.hikers();
    const suspended = hikers.filter((u) => u.status === 'suspended').length;
    const newHikers = hikers.filter((u) => (u.createdAt?.getTime() ?? 0) >= now - 30 * DAY).length;
    const cancelled = this.data.bookings().length - paid.length;

    return [
      {
        label: 'Revenue', icon: 'cash-outline', value: peso(sum(paid)),
        change: pctChange(sum(last30), sum(prev30)), note: `${peso(sum(last30))} in the last 30 days`,
      },
      {
        label: 'Bookings', icon: 'receipt-outline', value: paid.length.toLocaleString(),
        change: pctChange(last30.length, prev30.length),
        note: cancelled ? `${cancelled} cancelled` : `${last30.length} in the last 30 days`,
      },
      {
        label: 'Hikers', icon: 'people-outline', value: hikers.length.toLocaleString(), change: null,
        note: this.data.pendingCertificates()
          ? `${this.data.pendingCertificates()} documents to review`
          : suspended ? `${suspended} suspended` : newHikers ? `${newHikers} joined this month` : 'Registered accounts',
      },
    ];
  });

  readonly legend = computed(() => {
    switch (this.period()) {
      case 'week': return { now: 'This week', before: 'Last week' };
      case 'month': return { now: 'This month', before: 'Last month' };
      default: return { now: 'This year', before: 'Last year' };
    }
  });

  readonly buckets = computed<Bucket[]>(() => {
    const paid = this.paid();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (this.period() === 'week') {
      const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY);
      const out = WEEKDAYS.map((label) => ({ label, now: 0, before: 0 }));
      for (const b of paid) {
        const t = b.createdAt?.getTime();
        if (t == null) continue;
        const d = Math.floor((t - monday.getTime()) / DAY);
        if (d >= 0 && d < 7) out[d].now += b.total;
        else if (d >= -7 && d < 0) out[d + 7].before += b.total;
      }
      return out;
    }

    if (this.period() === 'month') {
      const y = today.getFullYear();
      const m = today.getMonth();
      const out = ['W1', 'W2', 'W3', 'W4', 'W5'].map((label) => ({ label, now: 0, before: 0 }));
      const prevY = m === 0 ? y - 1 : y;
      const prevM = m === 0 ? 11 : m - 1;
      for (const b of paid) {
        const d = b.createdAt;
        if (!d) continue;
        const w = Math.min(4, Math.floor((d.getDate() - 1) / 7));
        if (d.getFullYear() === y && d.getMonth() === m) out[w].now += b.total;
        else if (d.getFullYear() === prevY && d.getMonth() === prevM) out[w].before += b.total;
      }
      return out;
    }

    const y = today.getFullYear();
    const out = MONTHS.map((label) => ({ label, now: 0, before: 0 }));
    for (const b of paid) {
      const d = b.createdAt;
      if (!d) continue;
      if (d.getFullYear() === y) out[d.getMonth()].now += b.total;
      else if (d.getFullYear() === y - 1) out[d.getMonth()].before += b.total;
    }
    return out;
  });

  readonly chartTotal = computed(() => this.buckets().reduce((s, b) => s + b.now, 0));
  readonly previousTotal = computed(() => this.buckets().reduce((s, b) => s + b.before, 0));

  private readonly chartMax = computed(() => {
    const max = Math.max(0, ...this.buckets().flatMap((b) => [b.now, b.before]));
    return niceCeil(max || 4000);
  });

  readonly ticks = computed(() => {
    const max = this.chartMax();
    return [0, 1, 2, 3, 4].map((i) => pesoShort((max / 4) * i));
  });

  readonly recent = computed(() => this.data.bookings().slice(0, 6));

  private readonly sortedHikers = computed(() =>
    [...this.data.hikers()].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
  );
  readonly faces = computed(() => this.sortedHikers().slice(0, 4));
  readonly extraHikers = computed(() => Math.max(0, this.sortedHikers().length - 4));

  readonly community = computed(() => {
    const week = this.cPeriod() === 'week';
    const size = week ? 1 : 3;
    const count = week ? 7 : 10;
    const span = size * count * DAY;
    const end = new Date();
    end.setHours(24, 0, 0, 0);
    const start = end.getTime() - span;

    const buckets = Array.from({ length: count }, (_, i) => {
      const from = new Date(start + i * size * DAY);
      return { label: from.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), posts: 0, reviews: 0 };
    });
    let posts = 0;
    let prevPosts = 0;
    let reviews = 0;
    for (const p of this.data.posts()) {
      if (p.repostOf) continue;
      const t = p.createdAt?.getTime();
      if (t == null) continue;
      const i = Math.floor((t - start) / (size * DAY));
      if (i >= 0 && i < count) { buckets[i].posts++; posts++; }
      else if (t >= start - span && t < start) prevPosts++;
    }
    for (const r of this.data.reviews()) {
      const t = r.createdAt?.getTime();
      if (t == null) continue;
      const i = Math.floor((t - start) / (size * DAY));
      if (i >= 0 && i < count) { buckets[i].reviews++; reviews++; }
    }
    const max = Math.max(1, ...buckets.flatMap((b) => [b.posts, b.reviews]));
    return { buckets, max, posts, reviews, change: pctChange(posts, prevPosts) };
  });

  constructor() {
    addIcons({ arrowDown, arrowForward, arrowUp, cashOutline, peopleOutline, receiptOutline, send, trendingUp });
  }

  /** Performs the pct operation for this feature and returns its result to the caller. */
  pct(v: number): number {
    return Math.min(100, (v / this.chartMax()) * 100);
  }

  /** Performs the dpct operation for this feature and returns its result to the caller. */
  dpct(v: number): number {
    return (v / this.community().max) * 92;
  }

  /** Converts a record status into the readable text shown in the interface. */
  statusLabel(b: AdminBooking): string {
    const s = effectiveStatus(b);
    return s === 'cancelled' ? 'Cancelled' : s === 'completed' ? 'Completed' : 'Upcoming';
  }

  /** Maps a status value to the visual style used by the interface. */
  tone(b: AdminBooking): string {
    const s = effectiveStatus(b);
    return s === 'cancelled' ? 'red' : s === 'completed' ? 'ink' : 'green';
  }

  /** Opens the booking detail view for the selected record. */
  openBooking(b: AdminBooking): void {
    this.router.navigate(['/admin/bookings'], { queryParams: { open: b.id } });
  }

  /** Opens a booking by id (the attendance list), where its checklist is shown. */
  openBookingId(id: string): void {
    this.router.navigate(['/admin/bookings'], { queryParams: { open: id } });
  }

  // ── attendance ───────────────────────────────────────────────────────────

  /** The newest checklists guides have saved, joined to their bookings. */
  readonly attendanceRecent = computed(() => {
    const byId = new Map(this.data.bookings().map((b) => [b.id, b]));
    return Object.values(this.data.attendance())
      .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0))
      .slice(0, 6)
      .map((rec) => {
        const b = byId.get(rec.bookingId);
        const s = summarize(rec);
        return {
          id: rec.bookingId,
          trail: b?.trailName || rec.trailName,
          reference: b?.reference || rec.reference,
          image: b?.trailImage ?? '',
          hiker: b?.userName || b?.userEmail || 'Hiker',
          when: rec.date ? new Date(rec.date + 'T00:00:00') : null,
          guide: b?.guideName || GUIDES.find((g) => g.id === rec.guideId)?.name || 'Guide',
          present: s.present,
          total: s.total,
          tone: s.present === s.total ? 'green' : s.present === 0 ? 'red' : 'amber',
        };
      });
  });

  /** Present and absent hikers across checklists saved in the last 30 days. */
  readonly attendanceTotals = computed(() => {
    const since = Date.now() - 30 * DAY;
    let present = 0;
    let absent = 0;
    for (const rec of Object.values(this.data.attendance())) {
      if ((rec.updatedAt?.getTime() ?? 0) < since) continue;
      const s = summarize(rec);
      present += s.present;
      absent += s.absent;
    }
    return { present, absent };
  });

  /** Opens the hiker detail view for the selected record. */
  openHiker(uid: string): void {
    this.router.navigate(['/admin/hikers'], { queryParams: { open: uid } });
  }

  /** Looks up a hiker record for the supplied identifier. */
  findHiker(): void {
    const q = this.hikerQuery.trim();
    this.router.navigate(['/admin/hikers'], { queryParams: q ? { q } : {} });
  }

  /** Performs the hide img operation for this feature and returns its result to the caller. */
  hideImg(e: Event): void {
    (e.target as HTMLImageElement).style.visibility = 'hidden';
  }

  abs = Math.abs;
  peso = peso;
  ini = initials;
  tint = tintFor;
}

/** Rounds up to 1, 2, 2.5 or 5 × a power of ten, so axis labels stay tidy. */
function niceCeil(v: number): number {
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 4 ? 4 : f <= 5 ? 5 : 10;
  return nice * exp;
}
