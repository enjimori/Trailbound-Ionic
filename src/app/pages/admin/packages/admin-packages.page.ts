/**
 * Packages — the rate sheet (packages, activities, guides, merchandise) with
 * how often each one has been booked. The prices are set in code
 * (pages/booking/booking-catalog.ts), so this page shows them read-only.
 */
import { Component, computed, inject } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkOutline, informationCircleOutline } from 'ionicons/icons';

import { AdminDataService, countsAsRevenue } from '../admin-data.service';
import { initials, peso, tintFor } from '../admin-utils';
import { ACTIVITIES, GUIDES, MERCH, PACKAGES, TRANSACTION_FEE } from '../../booking/booking-catalog';
import { GUIDE_PROFILES } from '../../booking/guide-profiles';

@Component({
  selector: 'app-admin-packages',
  standalone: true,
  imports: [IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Packages</h1>
        <p>The rate sheet hikers book from, and how each item is selling.</p>
      </div>
    </div>

    <p class="note">
      <ion-icon name="information-circle-outline"></ion-icon>
      Prices are set in <code>src/app/pages/booking/booking-catalog.ts</code>. Change them there and rebuild the app.
      Every booking also adds a {{ peso(fee) }} transaction fee.
    </p>

    <div class="pkgs">
      @for (p of packageStats(); track p.id) {
        <article class="tba-card pkg" [class.top]="p.id === bestPackage()">
          @if (p.id === bestPackage() && p.count) { <span class="tba-badge" data-tone="sand">Most booked</span> }
          <h3>{{ p.name }}</h3>
          <strong>{{ peso(p.price) }}</strong>
          <ul>
            @for (line of p.includes; track $index) { <li><ion-icon name="checkmark-outline"></ion-icon>{{ line }}</li> }
          </ul>
          <div class="usage">
            <div><b>{{ p.count }}</b><span>bookings</span></div>
            <div><b>{{ peso(p.revenue) }}</b><span>revenue</span></div>
          </div>
          <i class="share"><b [style.width.%]="p.share"></b></i>
        </article>
      }
    </div>

    <div class="two">
      <section class="tba-card">
        <h2>Activities</h2>
        <table class="tba-table">
          <thead><tr><th>Activity</th><th class="num">Price</th><th class="num">Booked</th></tr></thead>
          <tbody>
            @for (a of activityStats(); track a.id) {
              <tr><td><b>{{ a.name }}</b>@if (a.note) { <small class="sub">Starting rate</small> }</td><td class="num">{{ peso(a.price) }}</td><td class="num">{{ a.count }}</td></tr>
            }
          </tbody>
        </table>
      </section>

      <section class="tba-card">
        <h2>Merchandise</h2>
        <table class="tba-table">
          <thead><tr><th>Item</th><th class="num">Price</th><th class="num">Sold</th><th class="num">Revenue</th></tr></thead>
          <tbody>
            @for (m of merchStats(); track m.id) {
              <tr><td><b>{{ m.name }}</b></td><td class="num">{{ peso(m.price) }}</td><td class="num">{{ m.qty }}</td><td class="num">{{ peso(m.revenue) }}</td></tr>
            }
          </tbody>
        </table>
      </section>
    </div>

    <section class="tba-card">
      <h2>Guides</h2>
      <div class="guides">
        @for (g of guideStats(); track g.id) {
          <div class="guide">
            <span class="tba-avatar" [style.background]="tint(g.name)">{{ ini(g.name) }}</span>
            <div class="g-body">
              <b>{{ g.name }}</b>
              <small>{{ g.title }}</small>
              <p>{{ g.years }} yrs · {{ g.summits }} summits · <strong>{{ g.count }} bookings</strong></p>
              <div class="tags">@for (s of g.specialties; track s) { <span>{{ s }}</span> }</div>
            </div>
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    .note { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 18px; padding: 12px 14px; border-radius: 14px; background: var(--tba-cream); font-size: 13px; line-height: 1.5; color: var(--tba-ink-2); }
    .note ion-icon { font-size: 18px; flex: none; margin-top: 1px; }
    .note code { background: rgba(0,0,0,.05); padding: 1px 5px; border-radius: 5px; font-size: 12px; }
    .pkgs { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; margin-bottom: 18px; }
    .pkg { position: relative; display: flex; flex-direction: column; }
    .pkg.top { border-color: var(--tba-sand); box-shadow: 0 0 0 1px var(--tba-sand) inset; }
    .pkg .tba-badge { position: absolute; top: -11px; right: 16px; background: var(--tba-sand); color: var(--tba-ink); }
    .pkg h3 { font-size: 14px; font-weight: 600; color: var(--tba-muted); }
    .pkg strong { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 12px; }
    .pkg ul { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 6px; font-size: 12.5px; color: var(--tba-ink-2); flex: 1; }
    .pkg li { display: flex; gap: 6px; line-height: 1.4; }
    .pkg li ion-icon { color: var(--tba-up); flex: none; margin-top: 2px; }
    .usage { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 12px; border-top: 1px solid var(--tba-line); }
    .usage b { display: block; font-size: 15px; }
    .usage span { font-size: 11.5px; color: var(--tba-muted); }
    .share { display: block; height: 5px; border-radius: 99px; background: var(--tba-soft); margin-top: 12px; overflow: hidden; }
    .share b { display: block; height: 100%; background: var(--tba-ink); border-radius: 99px; }
    .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; margin-bottom: 18px; }
    h2 { font-size: 16px; font-weight: 700; margin-bottom: 12px !important; }
    .tba-table th:first-child, .tba-table td:first-child { padding-left: 0; }
    .tba-table th:last-child, .tba-table td:last-child { padding-right: 0; }
    .sub { display: block; font-size: 11.5px; color: var(--tba-muted); }
    .guides { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .guide { display: flex; gap: 12px; padding: 14px; border-radius: 14px; background: var(--tba-soft); }
    .g-body { min-width: 0; }
    .g-body b { display: block; }
    .g-body small { font-size: 12px; color: var(--tba-muted); }
    .g-body p { margin: 6px 0 8px; font-size: 12.5px; color: var(--tba-ink-2); }
    .tags { display: flex; flex-wrap: wrap; gap: 5px; }
    .tags span { font-size: 11px; padding: 3px 8px; border-radius: 99px; background: #fff; color: var(--tba-ink-2); }
  `],
})
export class AdminPackagesPage {
  private readonly data = inject(AdminDataService);
  readonly fee = TRANSACTION_FEE;

  private readonly paid = computed(() => this.data.bookings().filter(countsAsRevenue));

  readonly packageStats = computed(() => {
    const paid = this.paid();
    const rows = PACKAGES.map((p) => {
      const mine = paid.filter((b) => b.packageId === p.id);
      return { ...p, count: mine.length, revenue: mine.reduce((s, b) => s + b.total, 0), share: 0 };
    });
    const max = Math.max(1, ...rows.map((r) => r.count));
    rows.forEach((r) => (r.share = (r.count / max) * 100));
    return rows;
  });

  readonly bestPackage = computed(() => {
    const rows = this.packageStats();
    const best = rows.reduce((a, b) => (b.count > a.count ? b : a), rows[0]);
    return best?.count ? best.id : '';
  });

  readonly activityStats = computed(() => {
    const paid = this.paid();
    return ACTIVITIES.map((a) => ({
      ...a,
      count: paid.filter((b) => b.activityNames.includes(a.name)).length,
    }));
  });

  readonly merchStats = computed(() => {
    const paid = this.paid();
    return MERCH.map((m) => {
      let qty = 0;
      let revenue = 0;
      for (const b of paid) {
        for (const line of b.merch) {
          if (line.id === m.id) {
            qty += line.qty;
            revenue += line.lineTotal;
          }
        }
      }
      return { ...m, qty, revenue };
    });
  });

  readonly guideStats = computed(() => {
    const paid = this.paid();
    return GUIDES.map((g) => {
      const profile = GUIDE_PROFILES[g.name];
      return {
        ...g,
        title: profile?.title ?? 'Guide',
        specialties: profile?.specialties ?? [],
        count: paid.filter((b) => b.guideName === g.name).length,
      };
    });
  });

  constructor() {
    addIcons({ checkmarkOutline, informationCircleOutline });
  }

  peso = peso;
  ini = initials;
  tint = tintFor;
}
