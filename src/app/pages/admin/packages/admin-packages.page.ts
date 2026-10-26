/**
 * Packages — manage custom packages, merchandise and guides alongside the
 * booking catalog's activities and sales summaries.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, checkmarkOutline, informationCircleOutline, trailSignOutline } from 'ionicons/icons';

import { AdminDataService, countsAsRevenue } from '../admin-data.service';
import { AdminUiService } from '../admin-ui.service';
import { CatalogService } from '../../../services/catalog.service';
import { initials, peso, tintFor } from '../admin-utils';
import { ACTIVITIES } from '../../booking/booking-catalog';
import { GUIDE_PROFILES } from '../../booking/guide-profiles';
import { TrailService } from '../../../services/trail.service';
import { allTrails } from '../../explore/trail-lookup';
import { dayKey, matches } from '../admin-utils';

@Component({
  selector: 'app-admin-packages',
  standalone: true,
  imports: [FormsModule, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Packages</h1>
        <p>Manage the packages, merchandise and guides available to hikers.</p>
      </div>
    </div>

    <section class="tba-card manage">
      <div class="manage-head">
        <div><h2>Hike packages</h2><p>New packages appear in checkout once saved.</p></div>
        <button type="button" class="tba-btn primary" (click)="togglePackageForm()">
          <ion-icon name="add-outline"></ion-icon>Add package
        </button>
      </div>
      @if (packageFormOpen()) {
        <div class="entry-form">
          <label class="tba-field">Package name<input class="tba-input-box" [(ngModel)]="packageName" maxlength="60" /></label>
          <label class="tba-field">Price (PHP)<input class="tba-input-box" type="number" min="1" step="1" [(ngModel)]="packagePrice" /></label>
          <label class="tba-field">What's included (one item per line)<textarea class="tba-input-box" rows="4" [(ngModel)]="packageIncludes"></textarea></label>
          <button type="button" class="tba-btn primary" [disabled]="saving()" (click)="createPackage()">
            {{ saving() ? 'Saving…' : 'Save package' }}
          </button>
        </div>
      }
    </section>

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
        <div class="tba-table-wrap">
          <table class="tba-table">
            <thead><tr><th>Activity</th><th class="num">Price</th><th class="num">Booked</th></tr></thead>
            <tbody>
              @for (a of activityStats(); track a.id) {
                <tr><td><b>{{ a.name }}</b>@if (a.note) { <small class="sub">Starting rate</small> }</td><td class="num">{{ peso(a.price) }}</td><td class="num">{{ a.count }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="tba-card">
        <div class="manage-head">
          <div><h2>Merchandise</h2><p>Add items hikers can include with a booking.</p></div>
          <button type="button" class="tba-btn primary" (click)="toggleMerchForm()">
            <ion-icon name="add-outline"></ion-icon>Add merch
          </button>
        </div>
        @if (merchFormOpen()) {
          <div class="entry-form">
            <label class="tba-field">Item name<input class="tba-input-box" [(ngModel)]="merchName" maxlength="60" /></label>
            <label class="tba-field">Price (PHP)<input class="tba-input-box" type="number" min="1" step="1" [(ngModel)]="merchPrice" /></label>
            <button type="button" class="tba-btn primary" [disabled]="saving()" (click)="createMerch()">
              {{ saving() ? 'Saving…' : 'Save merchandise' }}
            </button>
          </div>
        }
        <div class="tba-table-wrap">
          <table class="tba-table">
            <thead><tr><th>Item</th><th class="num">Price</th><th class="num">Sold</th><th class="num">Revenue</th></tr></thead>
            <tbody>
              @for (m of merchStats(); track m.id) {
                <tr><td><b>{{ m.name }}</b></td><td class="num">{{ peso(m.price) }}</td><td class="num">{{ m.qty }}</td><td class="num">{{ peso(m.revenue) }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="tba-card">
      <div class="manage-head">
        <div>
          <h2>Guides</h2>
          <p>A guide added here can be picked on the booking page and linked to a staff account.</p>
        </div>
        <button type="button" class="tba-btn primary" (click)="toggleGuideForm()">
          <ion-icon name="add-outline"></ion-icon>Add guide
        </button>
      </div>

      @if (guideFormOpen()) {
        <div class="entry-form">
          <label class="tba-field">Full name<input class="tba-input-box" [(ngModel)]="guideName" maxlength="60" placeholder="e.g. Ramon Santos" /></label>
          <label class="tba-field">Role<input class="tba-input-box" [(ngModel)]="guideTitle" maxlength="60" placeholder="e.g. Lead mountain guide" /></label>
          <div class="pair">
            <label class="tba-field">Years guiding<input class="tba-input-box" type="number" min="0" step="1" [(ngModel)]="guideYears" /></label>
            <label class="tba-field">Summits<input class="tba-input-box" type="number" min="0" step="1" [(ngModel)]="guideSummits" /></label>
          </div>
          <label class="tba-field">Specialties (one per line)<textarea class="tba-input-box" rows="3" [(ngModel)]="guideSpecialties" placeholder="Sunrise summits&#10;Cordillera trails"></textarea></label>
          <p class="hint">
            <ion-icon name="information-circle-outline"></ion-icon>
            Use the guide's real credentials. These appear to hikers choosing who leads
            them up a mountain, so invented experience is not a harmless placeholder.
          </p>
          <button type="button" class="tba-btn primary" [disabled]="saving()" (click)="createGuide()">
            {{ saving() ? 'Saving…' : 'Save guide' }}
          </button>
        </div>
      }

      <div class="guides">
        @for (g of guideStats(); track g.id) {
          <div class="guide">
            <span class="tba-avatar" [style.background]="tint(g.name)">{{ ini(g.name) }}</span>
            <div class="g-body">
              <b>{{ g.name }}</b>
              <small>{{ g.title }}</small>
              <p>{{ g.years }} yrs · {{ g.summits }} summits · <strong>{{ g.count }} bookings</strong></p>
              <div class="tags">@for (s of g.specialties; track s) { <span>{{ s }}</span> }</div>
              <!-- Which mountains this guide is offered on (guide_trails/{id}). -->
              <div class="g-trails">
                <span class="g-trails-label"><ion-icon name="trail-sign-outline"></ion-icon>Mountains</span>
                <span class="g-trails-list">{{ assignedLabel(g.id) }}</span>
                <button type="button" class="tba-btn sm" (click)="editTrails(g)">Edit mountains</button>
              </div>
            </div>
          </div>
        }
      </div>

      @if (editingGuide(); as eg) {
        <div class="trail-editor">
          <h3>Mountains {{ eg.name }} guides</h3>
          <p class="hint">
            <ion-icon name="information-circle-outline"></ion-icon>
            Hikers only see {{ eg.name }} on the booking page for the mountains ticked here, and TrailBound
            cannot confirm a booking with them on any other mountain.
          </p>
          <div class="tba-chips" role="group" aria-label="Restriction">
            <button type="button" [class.on]="trailMode() === 'any'" (click)="trailMode.set('any')">Any mountain</button>
            <button type="button" [class.on]="trailMode() === 'only'" (click)="trailMode.set('only')">Only these mountains</button>
          </div>

          @if (trailMode() === 'only') {
            <label class="tba-filter trail-find">
              <input [ngModel]="trailQuery()" (ngModelChange)="trailQuery.set($event)" placeholder="Find a mountain" />
            </label>
            <div class="trail-checks">
              @for (t of filteredTrails(); track t.id) {
                <label class="trail-check" [class.on]="picked().has(t.id)">
                  <input type="checkbox" [checked]="picked().has(t.id)" (change)="toggleTrail(t.id)" />
                  <span><b>{{ t.name }}</b><small>{{ t.region }}</small></span>
                </label>
              } @empty {
                <p class="none">No mountain matches “{{ trailQuery() }}”.</p>
              }
            </div>
            <p class="picked-count">{{ picked().size }} selected</p>
            @if (conflicts().length) {
              <p class="warn">
                {{ conflicts().length }} upcoming {{ conflicts().length === 1 ? 'booking' : 'bookings' }} with {{ eg.name }}
                {{ conflicts().length === 1 ? 'is' : 'are' }} on a mountain not ticked here
                ({{ conflictNames() }}). {{ conflicts().length === 1 ? 'It stays' : 'They stay' }} as booked, but cannot be
                confirmed until that mountain is added back or the booking is cancelled.
              </p>
            }
          }

          <div class="editor-acts">
            <button type="button" class="tba-btn ghost" [disabled]="saving()" (click)="editingGuide.set(null)">Cancel</button>
            <button type="button" class="tba-btn primary" [disabled]="saving()" (click)="saveTrails()">
              {{ saving() ? 'Saving…' : 'Save mountains' }}
            </button>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .manage { margin-bottom: 16px; }
    .manage-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .manage-head > div { min-width: 0; }
    .manage-head > .tba-btn { flex: none; }
    .manage-head h2 { margin: 0 0 3px !important; }
    .manage-head p { margin: 0; color: var(--tba-muted); font-size: 12.5px; line-height: 1.45; }
    .entry-form { display: grid; gap: 12px; width: 100%; min-width: 0; max-width: 560px; margin: 16px 0; padding-top: 16px; border-top: 1px solid var(--tba-line); }
    .entry-form .tba-field { min-width: 0; }
    .entry-form textarea { height: auto; min-height: 72px; padding: 10px 14px; resize: vertical; }
    .entry-form .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .entry-form .hint { display: flex; gap: 8px; margin: 0; font-size: 12px; line-height: 1.5; color: var(--tba-muted); }
    .entry-form .hint ion-icon { flex: none; margin-top: 1px; font-size: 15px; }
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
    .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 14px; margin-bottom: 18px; }
    .two > * { min-width: 0; }
    .two .tba-table-wrap { min-width: 0; overflow-x: auto; }
    .two .tba-table { min-width: 360px; table-layout: auto; }
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
    .tags span { font-size: 11px; padding: 3px 8px; border-radius: 99px; background: var(--tba-surface); color: var(--tba-ink-2); }
    .g-trails { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--tba-line); font-size: 12px; }
    .g-trails-label { display: inline-flex; align-items: center; gap: 5px; color: var(--tba-muted); font-weight: 600; }
    .g-trails-list { flex: 1 1 100%; color: var(--tba-text); line-height: 1.45; }
    .trail-editor { display: grid; gap: 12px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--tba-line); }
    .trail-editor h3 { font-size: 15px; font-weight: 700; }
    .trail-editor .tba-chips { justify-self: start; }
    .trail-editor .hint { display: flex; gap: 8px; margin: 0; font-size: 12px; line-height: 1.5; color: var(--tba-muted); }
    .trail-editor .hint ion-icon { flex: none; margin-top: 1px; font-size: 15px; }
    .trail-find { max-width: 320px; }
    .trail-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px; max-height: 320px; overflow-y: auto; padding: 2px; }
    .trail-check { display: flex; align-items: flex-start; gap: 9px; padding: 9px 10px; border: 1px solid var(--tba-line); border-radius: 10px; background: var(--tba-surface); cursor: pointer; }
    .trail-check.on { border-color: var(--tba-sand); background: var(--tba-sand-soft); }
    .trail-check input { margin-top: 2px; accent-color: var(--tba-ink); }
    .trail-check b { display: block; font-size: 12.5px; font-weight: 600; }
    .trail-check small { display: block; font-size: 11px; color: var(--tba-muted); }
    .trail-editor .none, .picked-count { margin: 0; font-size: 12px; color: var(--tba-muted); }
    .trail-editor .warn { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--tba-sand-soft); font-size: 12.5px; line-height: 1.5; }
    .editor-acts { display: flex; gap: 8px; justify-content: flex-end; }
    @media (max-width: 640px) {
      .entry-form .pair { grid-template-columns: 1fr; }
    }
  `],
})
export class AdminPackagesPage {
  private readonly data = inject(AdminDataService);
  private readonly catalog = inject(CatalogService);
  private readonly ui = inject(AdminUiService);
  readonly packageFormOpen = signal(false);
  readonly merchFormOpen = signal(false);
  readonly guideFormOpen = signal(false);
  readonly saving = signal(false);
  packageName = '';
  packagePrice: number | null = null;
  packageIncludes = '';
  merchName = '';
  merchPrice: number | null = null;
  guideName = '';
  guideTitle = '';
  guideYears: number | null = null;
  guideSummits: number | null = null;
  guideSpecialties = '';

  private readonly paid = computed(() => this.data.bookings().filter(countsAsRevenue));

  readonly packageStats = computed(() => {
    const paid = this.paid();
    const rows = this.catalog.packages().map((p) => {
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
    return this.catalog.merch().map((m) => {
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

  /**
   * The live roster — the three in booking-catalog.ts plus anything added
   * here. Reading catalog.guides() rather than the static GUIDES is what makes
   * a newly added guide appear in this list at all.
   *
   * Title and specialties come off the guide record for added guides, and fall
   * back to GUIDE_PROFILES for the original three, whose details live in code.
   * Neither file needs to know about the other.
   *
   * Bookings are counted by guideId first. guideName is kept as a fallback so
   * bookings made before guides had ids still count against the right person —
   * matching on a display name is exactly the fragility the id was added to
   * fix, so it is a fallback and nothing more.
   */
  // ── guide-to-mountain assignment ─────────────────────────────────────────

  private readonly trailService = inject(TrailService);

  /** Every mountain a booking can be made for — the same list as Admin → Trails. */
  readonly allMountains = computed(() =>
    this.catalog.withTrailOverrides([...allTrails(), ...this.trailService.addedTrails()]),
  );

  readonly editingGuide = signal<{ id: string; name: string } | null>(null);
  readonly trailMode = signal<'any' | 'only'>('any');
  readonly picked = signal<Set<string>>(new Set());
  readonly trailQuery = signal('');

  readonly filteredTrails = computed(() => {
    const q = this.trailQuery();
    return this.allMountains().filter((t) => matches(q, t.name, t.region));
  });

  /** Upcoming bookings with the guide being edited, on mountains not ticked. */
  readonly conflicts = computed(() => {
    const g = this.editingGuide();
    if (!g || this.trailMode() !== 'only') return [];
    const today = dayKey(new Date());
    const picked = this.picked();
    return this.data.bookings().filter((b) =>
      b.guideId === g.id && b.date >= today && (b.status === 'pending' || b.status === 'confirmed')
      && !picked.has(b.trailId));
  });

  conflictNames(): string {
    return [...new Set(this.conflicts().map((b) => b.trailName))].join(', ');
  }

  /** "Any mountain", or the assigned mountains by name. */
  assignedLabel(guideId: string): string {
    const ids = this.data.guideTrailsFor(guideId);
    if (ids === null) return 'Any mountain (not restricted yet)';
    const byId = new Map(this.allMountains().map((t) => [t.id, t.name]));
    return ids.map((id) => byId.get(id) ?? id).join(', ') || 'None';
  }

  editTrails(g: { id: string; name: string }): void {
    const current = this.data.guideTrailsFor(g.id);
    this.editingGuide.set({ id: g.id, name: g.name });
    this.trailMode.set(current === null ? 'any' : 'only');
    this.picked.set(new Set(current ?? []));
    this.trailQuery.set('');
  }

  toggleTrail(id: string): void {
    this.picked.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async saveTrails(): Promise<void> {
    const g = this.editingGuide();
    if (!g) return;
    let ok: boolean;
    if (this.trailMode() === 'any') {
      ok = await this.save(() => this.data.clearGuideTrails(g.id), `${g.name} can be booked on any mountain`);
    } else {
      if (!this.picked().size) {
        this.ui.toast('Tick at least one mountain, or choose Any mountain.', 'error');
        return;
      }
      const ids = [...this.picked()];
      ok = await this.save(() => this.data.setGuideTrails(g.id, ids), `Mountains saved for ${g.name}`);
    }
    // Stays open on failure so nothing ticked is lost.
    if (ok) this.editingGuide.set(null);
  }

  readonly guideStats = computed(() => {
    const paid = this.paid();
    return this.catalog.guides().map((g) => {
      const profile = GUIDE_PROFILES[g.name];
      const extra = g as unknown as { title?: string; specialties?: string[] };
      return {
        ...g,
        title: extra.title || profile?.title || 'Guide',
        specialties: extra.specialties?.length ? extra.specialties : (profile?.specialties ?? []),
        count: paid.filter((b) => (b.guideId ? b.guideId === g.id : b.guideName === g.name)).length,
      };
    });
  });

  constructor() {
    addIcons({ addOutline, checkmarkOutline, informationCircleOutline, trailSignOutline });
  }

  togglePackageForm(): void {
    this.packageFormOpen.update((open) => !open);
  }

  toggleMerchForm(): void {
    this.merchFormOpen.update((open) => !open);
  }

  toggleGuideForm(): void {
    this.guideFormOpen.update((open) => !open);
  }

  async createPackage(): Promise<void> {
    const name = this.packageName.trim();
    const price = Number(this.packagePrice);
    const includes = this.packageIncludes.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!name || !Number.isSafeInteger(price) || price <= 0 || !includes.length) {
      this.ui.toast('Enter a package name, positive whole-number price, and at least one inclusion.', 'error');
      return;
    }
    await this.save(async () => {
      await this.catalog.createPackage({ name, price, includes });
      this.packageName = '';
      this.packagePrice = null;
      this.packageIncludes = '';
      this.packageFormOpen.set(false);
    }, 'Package added');
  }

  async createMerch(): Promise<void> {
    const name = this.merchName.trim();
    const price = Number(this.merchPrice);
    if (!name || !Number.isSafeInteger(price) || price <= 0) {
      this.ui.toast('Enter an item name and a positive whole-number price.', 'error');
      return;
    }
    await this.save(async () => {
      await this.catalog.createMerch({ name, price, icon: 'trail-sign-outline' });
      this.merchName = '';
      this.merchPrice = null;
      this.merchFormOpen.set(false);
    }, 'Merchandise added');
  }

  /**
   * Adds a guide to the roster.
   *
   * The duplicate-name check is not cosmetic. A guide account is linked to a
   * roster entry by name on the Staff page, and two people called the same
   * thing make that link ambiguous — one of them would end up seeing the
   * other's hikes.
   */
  async createGuide(): Promise<void> {
    const name = this.guideName.trim();
    const title = this.guideTitle.trim();
    const years = Number(this.guideYears);
    const summits = Number(this.guideSummits);
    const specialties = this.guideSpecialties
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6);

    if (!name || !title) {
      this.ui.toast('A guide needs a name and a role.', 'error');
      return;
    }
    if (!Number.isSafeInteger(years) || years < 0 || !Number.isSafeInteger(summits) || summits < 0) {
      this.ui.toast('Years and summits must be whole numbers, zero or more.', 'error');
      return;
    }
    if (this.catalog.guides().some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      this.ui.toast(`${name} is already on the roster.`, 'error');
      return;
    }

    await this.save(async () => {
      await this.catalog.createGuide({ name, years, summits, title, specialties } as never);
      this.guideName = '';
      this.guideTitle = '';
      this.guideYears = null;
      this.guideSummits = null;
      this.guideSpecialties = '';
      this.guideFormOpen.set(false);
    }, 'Guide added');
  }

  /** One write with the saving flag and error toast every form shares. True when it saved. */
  private async save(write: () => Promise<void>, success: string): Promise<boolean> {
    this.saving.set(true);
    try {
      await write();
      this.ui.toast(success);
      return true;
    } catch (error) {
      this.ui.fail(error);
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  peso = peso;
  ini = initials;
  tint = tintFor;
}