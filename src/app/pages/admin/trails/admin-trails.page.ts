/**
 * Trails — the 30 trails hikers can book. Close a trail (with a reason the
 * hiker sees) to stop new bookings, reopen it later. Trail details themselves
 * live in explore-trails.data.ts, so they are read-only here.
 */
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, lockClosedOutline, lockOpenOutline, openOutline, searchOutline, star, trailSignOutline,
} from 'ionicons/icons';

import { AdminDataService, countsAsRevenue } from '../admin-data.service';
import { AdminUiService } from '../admin-ui.service';
import { dayKey, matches, peso } from '../admin-utils';
import { allTrails } from '../../explore/trail-lookup';
import type { Trail } from '../../../models/trail.model';

type Filter = 'all' | 'open' | 'closed';

@Component({
  selector: 'app-admin-trails',
  standalone: true,
  imports: [DatePipe, FormsModule, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Trails</h1>
        <p>{{ trails.length }} trails · {{ trails.length - data.closedCount() }} open · {{ data.closedCount() }} closed for booking</p>
      </div>
    </div>

    <div class="tba-toolbar">
      <label class="tba-filter">
        <ion-icon name="search-outline"></ion-icon>
        <input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Trail or region" />
      </label>
      <div class="tba-chips">
        @for (f of filters; track f.id) {
          <button type="button" [class.on]="filter() === f.id" (click)="filter.set(f.id)">{{ f.label }}</button>
        }
      </div>
      <div class="tba-chips">
        @for (d of difficulties; track d) {
          <button type="button" [class.on]="difficulty() === d" (click)="difficulty.set(d)">{{ d }}</button>
        }
      </div>
    </div>

    <div class="grid">
      @for (t of shown(); track t.id) {
        <article class="trail" [class.closed]="data.isClosed(t.id)" (click)="openId.set(t.id)">
          <div class="photo">
            <div class="img" [style.background-image]="'url(' + t.image + ')'"></div>
            <span class="tba-badge" [attr.data-tone]="data.isClosed(t.id) ? 'red' : 'green'">{{ data.isClosed(t.id) ? 'Closed' : 'Open' }}</span>
            <span class="diff" [attr.data-d]="t.difficulty">{{ t.difficulty }}</span>
          </div>
          <div class="body">
            <h3>{{ t.name }}</h3>
            <p>{{ t.region }}</p>
            <div class="nums">
              <span><b>{{ stats()[t.id]?.count ?? 0 }}</b> bookings</span>
              <span><b>{{ peso(stats()[t.id]?.revenue ?? 0) }}</b></span>
              @if (ratings()[t.id]; as r) { <span class="rate"><ion-icon name="star"></ion-icon>{{ r.avg }} ({{ r.n }})</span> }
            </div>
          </div>
        </article>
      } @empty {
        <div class="tba-card tba-empty wide">
          <ion-icon name="trail-sign-outline"></ion-icon>
          <h3>No trails match</h3>
          <p>Try another search or filter.</p>
        </div>
      }
    </div>

    @if (selected(); as t) {
      <div class="tba-drawer-wrap" (click)="close()">
        <aside class="tba-drawer" (click)="$event.stopPropagation()">
          <div class="hero" [style.background-image]="'url(' + t.image + ')'">
            <button type="button" class="tba-icon-btn" aria-label="Close" (click)="close()"><ion-icon name="close-outline"></ion-icon></button>
          </div>
          <div class="tba-drawer-body">
            <div class="title-row">
              <div>
                <h2>{{ t.name }}</h2>
                <p class="region">{{ t.region }}</p>
              </div>
              <span class="tba-badge" [attr.data-tone]="data.isClosed(t.id) ? 'red' : 'green'">{{ data.isClosed(t.id) ? 'Closed' : 'Open' }}</span>
            </div>

            @if (state(t.id); as s) {
              @if (s.status === 'closed') {
                <div class="closed-note">
                  <ion-icon name="lock-closed-outline"></ion-icon>
                  <div>
                    <b>Closed for booking</b>
                    <p>{{ s.note || 'No reason given.' }}</p>
                    @if (s.updatedAt) { <small>Since {{ s.updatedAt | date: 'MMM d, y, h:mm a' }}</small> }
                  </div>
                </div>
              }
            }

            <p class="desc">{{ t.description }}</p>

            <div class="facts">
              <div><span>Difficulty</span><b>{{ t.difficulty }}</b></div>
              <div><span>Distance</span><b>{{ t.distance }}</b></div>
              <div><span>Elevation</span><b>{{ t.elevation }}</b></div>
              <div><span>Duration</span><b>{{ t.duration }}</b></div>
            </div>

            <p class="tba-section-title">Bookings</p>
            <dl class="tba-dl">
              <div><dt>Total bookings</dt><dd>{{ stats()[t.id]?.count ?? 0 }}</dd></div>
              <div><dt>Upcoming hikes</dt><dd>{{ stats()[t.id]?.upcoming ?? 0 }}</dd></div>
              <div><dt>Revenue</dt><dd>{{ peso(stats()[t.id]?.revenue ?? 0) }}</dd></div>
              <div><dt>Reviews</dt><dd>{{ ratings()[t.id] ? ratings()[t.id].avg + ' ★ from ' + ratings()[t.id].n : 'None yet' }}</dd></div>
            </dl>
          </div>
          <footer>
            @if (data.isClosed(t.id)) {
              <button type="button" class="tba-btn primary" [disabled]="busy()" (click)="reopen(t)"><ion-icon name="lock-open-outline"></ion-icon>Reopen for booking</button>
            } @else {
              <button type="button" class="tba-btn danger" [disabled]="busy()" (click)="closeTrail(t)"><ion-icon name="lock-closed-outline"></ion-icon>Close for booking</button>
            }
            <a class="tba-btn" [href]="'/trail/' + t.id" target="_blank" rel="noopener"><ion-icon name="open-outline"></ion-icon>View in app</a>
          </footer>
        </aside>
      </div>
    }
  `,
  styles: [`
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }
    .wide { grid-column: 1 / -1; }
    .trail { border: 1px solid var(--tba-line); border-radius: 18px; overflow: hidden; background: #fff; cursor: pointer; transition: box-shadow .15s, transform .15s; }
    .trail:hover { box-shadow: 0 12px 28px rgba(29,36,32,.08); transform: translateY(-2px); }
    .trail.closed .img { filter: grayscale(.85) brightness(.9); }
    .photo { position: relative; height: 140px; background: var(--tba-sage); overflow: hidden; }
    .img { position: absolute; inset: 0; background: center / cover no-repeat; }
    .photo .tba-badge { position: absolute; top: 12px; left: 12px; background: rgba(255,255,255,.94); }
    .diff { position: absolute; top: 12px; right: 12px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; color: #fff; background: rgba(29,36,32,.7); }
    .diff[data-d='Easy'] { background: #2f6b3d; }
    .diff[data-d='Moderate'] { background: #9a6a1f; }
    .diff[data-d='Hard'] { background: #9c3a31; }
    .body { padding: 14px 16px 16px; }
    .body h3 { font-size: 15px; font-weight: 700; }
    .body p { margin: 3px 0 12px; font-size: 12.5px; color: var(--tba-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .nums { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--tba-muted); }
    .nums b { color: var(--tba-text); }
    .rate { display: inline-flex; align-items: center; gap: 3px; }
    .rate ion-icon { color: #e3a73a; }

    .hero { position: relative; height: 200px; flex: none; background: var(--tba-sage) center / cover no-repeat; }
    .hero .tba-icon-btn { position: absolute; top: 14px; right: 14px; background: rgba(255,255,255,.92); }
    .title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .title-row h2 { font-size: 20px; font-weight: 700; }
    .region { margin: 4px 0 0; color: var(--tba-muted); font-size: 13px; }
    .closed-note { display: flex; gap: 12px; margin: 16px 0 0; padding: 14px; border-radius: 14px; background: #fbe9e8; color: #8f2f2c; }
    .closed-note ion-icon { font-size: 20px; flex: none; }
    .closed-note p { margin: 3px 0; font-size: 13px; }
    .closed-note small { font-size: 11.5px; opacity: .8; }
    .desc { margin: 16px 0; font-size: 13.5px; line-height: 1.6; color: var(--tba-ink-2); }
    .facts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 22px; }
    .facts div { background: var(--tba-soft); border-radius: 12px; padding: 10px 12px; }
    .facts span { display: block; font-size: 11.5px; color: var(--tba-muted); }
    .facts b { font-size: 13.5px; }
  `],
})
export class AdminTrailsPage {
  readonly data = inject(AdminDataService);
  private readonly ui = inject(AdminUiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly trails = allTrails();
  readonly filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'closed', label: 'Closed' },
  ];
  readonly difficulties = ['Any', 'Easy', 'Moderate', 'Hard'];

  readonly q = signal('');
  readonly filter = signal<Filter>('all');
  readonly difficulty = signal('Any');
  readonly openId = signal<string | null>(null);
  readonly busy = signal(false);
  private readonly params = toSignal(this.route.queryParamMap);

  readonly shown = computed(() => {
    const f = this.filter();
    const d = this.difficulty();
    const q = this.q();
    this.data.trailStatus();
    return this.trails.filter(
      (t) =>
        (f === 'all' || (f === 'closed') === this.data.isClosed(t.id)) &&
        (d === 'Any' || t.difficulty === d) &&
        matches(q, t.name, t.region),
    );
  });

  readonly stats = computed(() => {
    const today = dayKey(new Date());
    const map: Partial<Record<string, { count: number; revenue: number; upcoming: number }>> = {};
    for (const b of this.data.bookings()) {
      const s = (map[b.trailId] ??= { count: 0, revenue: 0, upcoming: 0 });
      s.count++;
      if (countsAsRevenue(b)) s.revenue += b.total;
      if (b.status === 'confirmed' && b.date >= today) s.upcoming++;
    }
    return map;
  });

  readonly ratings = computed(() => {
    const sums: Record<string, { sum: number; n: number }> = {};
    for (const r of this.data.reviews()) {
      const s = (sums[r.trailId] ??= { sum: 0, n: 0 });
      s.sum += r.rating;
      s.n++;
    }
    const out: Record<string, { avg: number; n: number }> = {};
    for (const [id, s] of Object.entries(sums)) out[id] = { avg: Math.round((s.sum / s.n) * 10) / 10, n: s.n };
    return out;
  });

  readonly selected = computed(() => {
    const id = this.openId();
    return id ? this.trails.find((t) => t.id === id) ?? null : null;
  });

  constructor() {
    addIcons({ closeOutline, lockClosedOutline, lockOpenOutline, openOutline, searchOutline, star, trailSignOutline });
    effect(() => {
      const p = this.params();
      if (!p) return;
      untracked(() => {
        if (p.get('q')) this.q.set(p.get('q')!);
        this.openId.set(p.get('open'));
      });
    }, { allowSignalWrites: true });
  }

  state(id: string) {
    return this.data.trailStatus()[id];
  }

  close(): void {
    this.openId.set(null);
    if (this.route.snapshot.queryParamMap.has('open')) {
      this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  async closeTrail(t: Trail): Promise<void> {
    const note = await this.ui.ask({
      title: `Close ${t.name}?`,
      message: 'Hikers can still read about the trail, but the Book button is turned off and they see your reason.',
      confirmText: 'Close trail',
      danger: true,
      input: { label: 'Reason shown to hikers', placeholder: 'e.g. Closed for typhoon recovery until further notice' },
    });
    if (note === null) return;
    await this.run(() => this.data.setTrailStatus(t.id, 'closed', note), `${t.name} closed for booking`);
  }

  async reopen(t: Trail): Promise<void> {
    await this.run(() => this.data.setTrailStatus(t.id, 'open'), `${t.name} is open again`);
  }

  private async run(job: () => Promise<void>, done: string): Promise<void> {
    this.busy.set(true);
    try {
      await job();
      this.ui.toast(done);
    } catch (e) {
      this.ui.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  peso = peso;
}
