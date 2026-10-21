/**
 * Reviews — every trail review hikers have written. Remove one that breaks
 * the rules.
 */
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { searchOutline, star, starOutline, trashOutline } from 'ionicons/icons';

import { AdminDataService, AdminReview } from '../admin-data.service';
import { AdminUiService } from '../admin-ui.service';
import { matches, timeAgo } from '../admin-utils';

@Component({
  selector: 'app-admin-reviews',
  standalone: true,
  imports: [FormsModule, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Reviews</h1>
        <p>{{ data.reviews().length }} reviews · {{ average() }} average rating</p>
      </div>
    </div>

    <div class="summary tba-card">
      <div class="big">
        <strong>{{ average() }}</strong>
        <span class="stars">@for (s of [1,2,3,4,5]; track s) { <ion-icon [name]="s <= roundAvg() ? 'star' : 'star-outline'"></ion-icon> }</span>
        <small>{{ data.reviews().length }} reviews</small>
      </div>
      <div class="dist">
        @for (row of distribution(); track row.stars) {
          <button type="button" class="dist-row" [class.on]="rating() === row.stars" (click)="toggleRating(row.stars)">
            <span>{{ row.stars }} ★</span>
            <i><b [style.width.%]="row.pct"></b></i>
            <em>{{ row.n }}</em>
          </button>
        }
      </div>
    </div>

    <div class="tba-toolbar">
      <label class="tba-filter">
        <ion-icon name="search-outline"></ion-icon>
        <input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Trail, author or words" />
      </label>
      @if (rating()) { <button type="button" class="tba-btn sm" (click)="rating.set(0)">Showing {{ rating() }}★ only · clear</button> }
    </div>

    <div class="tba-card flush">
      @if (shown().length) {
        <div class="tba-table-wrap">
          <table class="tba-table">
            <thead><tr><th>Trail</th><th>Rating</th><th>Review</th><th class="hide-sm">By</th><th></th></tr></thead>
            <tbody>
              @for (r of shown(); track r.id) {
                <tr [class.hl]="r.id === highlight()">
                  <td><b class="nowrap">{{ r.trailName }}</b></td>
                  <td><span class="stars sm">@for (s of [1,2,3,4,5]; track s) { <ion-icon [name]="s <= r.rating ? 'star' : 'star-outline'"></ion-icon> }</span></td>
                  <td class="txt">{{ r.text }}</td>
                  <td class="muted hide-sm">{{ r.author }}<small>{{ ago(r.createdAt) }}</small></td>
                  <td class="act"><button type="button" class="tba-icon-btn del" aria-label="Remove review" title="Remove review" (click)="remove(r)"><ion-icon name="trash-outline"></ion-icon></button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="tba-empty">
          <ion-icon name="star-outline"></ion-icon>
          <h3>{{ data.reviews().length ? 'No reviews match' : 'No reviews yet' }}</h3>
          <p>{{ data.reviews().length ? 'Try another search.' : 'Reviews hikers write on a trail page appear here.' }}</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .summary { display: flex; gap: 32px; align-items: center; margin-bottom: 18px; flex-wrap: wrap; }
    .big { display: grid; justify-items: start; gap: 4px; min-width: 140px; }
    .big strong { font-size: 40px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
    .big small { color: var(--tba-muted); font-size: 12.5px; }
    .stars { display: inline-flex; gap: 2px; color: #e3a73a; font-size: 16px; }
    .stars.sm { font-size: 13px; }
    .dist { flex: 1; min-width: 240px; display: grid; gap: 6px; }
    .dist-row { display: grid; grid-template-columns: 36px 1fr 30px; align-items: center; gap: 10px; border: 0; background: none; padding: 3px 6px; border-radius: 8px; font-size: 12.5px; color: var(--tba-muted); }
    .dist-row.on, .dist-row:hover { background: var(--tba-soft); }
    .dist-row i { height: 8px; border-radius: 99px; background: var(--tba-soft); overflow: hidden; }
    .dist-row.on i { background: #fff; }
    .dist-row b { display: block; height: 100%; background: var(--tba-sand); border-radius: 99px; }
    .dist-row em { font-style: normal; text-align: right; }
    .flush { padding: 8px 8px 4px; }
    .flush .tba-table th:first-child, .flush .tba-table td:first-child { padding-left: 14px; }
    .nowrap { white-space: nowrap; }
    .txt { min-width: 220px; line-height: 1.5; }
    .muted small { display: block; font-size: 11.5px; }
    .act { width: 40px; }
    .del { color: var(--tba-down); font-size: 17px; }
    tr.hl td { background: #fff8ea; }
  `],
})
export class AdminReviewsPage {
  readonly data = inject(AdminDataService);
  private readonly ui = inject(AdminUiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly q = signal('');
  readonly rating = signal(0);
  readonly highlight = signal<string | null>(null);
  private readonly params = toSignal(this.route.queryParamMap);

  readonly average = computed(() => {
    const list = this.data.reviews();
    if (!list.length) return '0.0';
    return (list.reduce((s, r) => s + r.rating, 0) / list.length).toFixed(1);
  });
  readonly roundAvg = computed(() => Math.round(Number(this.average())));

  readonly distribution = computed(() => {
    const list = this.data.reviews();
    return [5, 4, 3, 2, 1].map((stars) => {
      const n = list.filter((r) => r.rating === stars).length;
      return { stars, n, pct: list.length ? (n / list.length) * 100 : 0 };
    });
  });

  readonly shown = computed(() => {
    const q = this.q();
    const rating = this.rating();
    return this.data.reviews().filter(
      (r) => (!rating || r.rating === rating) && matches(q, r.trailName, r.author, r.text),
    );
  });

  constructor() {
    addIcons({ searchOutline, star, starOutline, trashOutline });
    effect(() => {
      const p = this.params();
      if (!p) return;
      untracked(() => {
        if (p.get('q')) this.q.set(p.get('q')!);
        this.highlight.set(p.get('open'));
      });
    }, { allowSignalWrites: true });
  }

  toggleRating(stars: number): void {
    this.rating.set(this.rating() === stars ? 0 : stars);
  }

  async remove(r: AdminReview): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Remove this review?',
      message: `${r.author}’s ${r.rating}-star review of ${r.trailName} will be deleted for everyone.`,
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.data.deleteReview(r.id);
      this.ui.toast('Review removed');
      if (this.highlight() === r.id) {
        this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
      }
    } catch (e) {
      this.ui.fail(e);
    }
  }

  ago = timeAgo;
}
