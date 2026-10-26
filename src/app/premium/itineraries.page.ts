/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MY ITINERARIES   /itineraries  (list)   /itineraries/:id  (editor)
 *
 * TrailBound Basic: save up to 3 one-day itineraries — trail, date, a timed
 *   plan for the day and notes. Start from a booking or any trail.
 * TrailBound Pro: unlimited itineraries, plus the trip-management tools —
 *   multi-day plans, a group list (who is going, role, contact), and a shared
 *   group gear checklist where each item is assigned to someone. Share sends
 *   the whole plan to a group chat.
 * Without a plan the page explains the feature with an unlock button.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonContent, IonIcon, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline, arrowBackOutline, calendarOutline, checkmark, chevronForwardOutline, closeOutline,
  mapOutline, peopleOutline, shareSocialOutline, trashOutline,
} from 'ionicons/icons';

import { SubscriptionService } from '../services/subscription.service';
import { BookingService } from '../services/booking.service';
import { CatalogService } from '../services/catalog.service';
import { TrailService } from '../services/trail.service';
import { LockedFeatureComponent } from './locked-feature.component';
import {
  Itinerary, ItineraryService, SUGGESTED_GROUP_GEAR, defaultDay,
} from '../services/itinerary.service';
import { newId, todayKey, trailPool } from './premium';

const SHARED_STYLES = `
  .it-top { display: flex; align-items: center; gap: 10px; padding: calc(10px + env(safe-area-inset-top)) 14px 6px; }
  .it-back { width: 40px; height: 40px; border: none; border-radius: 12px; background: transparent; color: var(--app-text); display: grid; place-items: center; font-size: 22px; }
  .it-top h1 { flex: 1; margin: 0; font-size: 21px; font-weight: 500; color: var(--app-text); }
  .it-pill { padding: 4px 10px; border-radius: 999px; background: var(--app-accent-soft, rgba(232,217,156,0.12)); color: var(--app-accent); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .it-body { padding: 6px 16px 48px; }
  .it-card { margin-bottom: 12px; padding: 14px; border-radius: var(--app-radius, 16px); border: 1px solid var(--app-border); background: var(--app-card-bg); }
  .it-h { margin: 18px 0 8px; font-size: 15px; font-weight: 600; color: var(--app-text); display: flex; align-items: center; gap: 6px; }
  .it-h ion-icon { color: var(--app-accent); }
  .it-dim { font-size: 12.5px; color: var(--app-text-dim); line-height: 1.5; margin: 0; }
  .it-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
  .it-field span { font-size: 11.5px; color: var(--app-text-dim); }
  .it-input, .it-field input, .it-field select, .it-field textarea {
    width: 100%; min-height: 40px; padding: 8px 11px; border-radius: 11px;
    border: 1px solid var(--app-border-strong); background: var(--app-bg-raised); color: var(--app-text); font-size: 14px; font-family: inherit;
  }
  .it-btn { min-height: 44px; padding: 0 18px; border: none; border-radius: 999px; background: var(--app-cta, #e3e6bf); color: var(--app-on-accent, #161d18); font-weight: 600; font-size: 13.5px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  .it-btn.ghost { background: transparent; border: 1px solid var(--app-border-strong); color: var(--app-text); }
  .it-btn:disabled { opacity: 0.45; }
  .it-link { border: none; background: none; padding: 6px 0; color: var(--app-accent); font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; }
  .it-icon-btn { width: 34px; height: 34px; flex-shrink: 0; border: none; border-radius: 10px; background: transparent; color: var(--app-text-dim); display: grid; place-items: center; font-size: 17px; }
`;

// ── List ─────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-itineraries',
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonIcon, LockedFeatureComponent],
  template: `
    <ion-content [fullscreen]="true">
      <div class="it-top">
        <button class="it-back" (click)="goBack()" aria-label="Go back"><ion-icon name="arrow-back-outline"></ion-icon></button>
        <h1>My Itineraries</h1>
        <span class="it-pill" *ngIf="unlocked()">{{ limit() === null ? 'Unlimited' : count() + ' of ' + limit() }}</span>
      </div>

      <div class="it-body">
        <app-locked-feature *ngIf="!unlocked()" feature="saveItineraries" title="Save itineraries"
          text="Plan each hike: the trail, the date and a timed plan for the day — saved to your account. Pro adds unlimited plans, multi-day trips, your group list and a shared gear checklist.">
        </app-locked-feature>

        <ng-container *ngIf="unlocked()">
          <!-- New -->
          <div class="it-card" *ngIf="creating(); else newBtn">
            <p class="it-h" style="margin-top:0"><ion-icon name="add-outline"></ion-icon> New itinerary</p>

            <ng-container *ngIf="upcoming().length">
              <span class="it-dim">From one of your bookings</span>
              <div class="it-chips">
                <button type="button" *ngFor="let b of upcoming()" (click)="fromBooking(b.id)">{{ b.trailName }} · {{ b.date }}</button>
              </div>
            </ng-container>

            <label class="it-field"><span>Trail</span>
              <select [(ngModel)]="newTrailId">
                <option value="" disabled>Choose a trail</option>
                <option *ngFor="let t of trails" [value]="t.id">{{ t.name }} — {{ t.region }}</option>
              </select>
            </label>
            <label class="it-field"><span>Hike date (optional)</span>
              <input type="date" [(ngModel)]="newDate" [min]="today" />
            </label>
            <label class="it-field"><span>Name (optional)</span>
              <input type="text" maxlength="60" [(ngModel)]="newTitle" placeholder="e.g. Birthday climb" />
            </label>
            <div class="it-row">
              <button class="it-btn" [disabled]="!newTrailId" (click)="create()">Create</button>
              <button class="it-btn ghost" (click)="creating.set(false)">Cancel</button>
            </div>
          </div>
          <ng-template #newBtn>
            <button class="it-btn it-new" *ngIf="canCreate()" (click)="creating.set(true)">
              <ion-icon name="add-outline"></ion-icon> New itinerary
            </button>
            <app-locked-feature *ngIf="!canCreate()" feature="unlimitedItineraries" title="You've saved {{ count() }} of {{ limit() }} itineraries"
              text="Delete one to make room, or upgrade for unlimited itineraries and trip-planning tools."></app-locked-feature>
          </ng-template>

          <!-- Saved -->
          <p class="it-dim it-empty" *ngIf="!itineraries().length">No itineraries yet. Create one from a booking or any trail.</p>
          <article class="it-card it-item" *ngFor="let it of itineraries()" (click)="open(it)">
            <div class="it-item-text">
              <b>{{ it.title }}</b>
              <span><ion-icon name="map-outline"></ion-icon>{{ it.trailName }}</span>
              <span><ion-icon name="calendar-outline"></ion-icon>{{ it.date ? (it.date | date: 'EEE, MMM d, y') : 'Date not set' }}
                · {{ it.days.length }} {{ it.days.length === 1 ? 'day' : 'days' }}<ng-container *ngIf="it.members.length"> · {{ it.members.length }} people</ng-container></span>
            </div>
            <button class="it-icon-btn" (click)="remove($event, it)" aria-label="Delete itinerary"><ion-icon name="trash-outline"></ion-icon></button>
            <ion-icon class="chev" name="chevron-forward-outline"></ion-icon>
          </article>
        </ng-container>
      </div>
    </ion-content>
  `,
  styles: [SHARED_STYLES + `
    .it-new { width: 100%; margin-bottom: 14px; }
    .it-row { display: flex; gap: 8px; }
    .it-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 12px; }
    .it-chips button { padding: 6px 10px; border-radius: 999px; border: 1px solid var(--app-border-strong); background: transparent; color: var(--app-text); font-size: 12px; }
    .it-empty { margin: 8px 2px; }
    .it-item { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .it-item-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .it-item-text b { font-size: 15px; color: var(--app-text); font-weight: 600; }
    .it-item-text span { display: flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--app-text-dim); }
    .it-item-text ion-icon { color: var(--app-accent); }
    .chev { color: var(--app-text-dim); }
  `],
})
export class ItinerariesPage {
  private readonly service = inject(ItineraryService);
  private readonly subscriptions = inject(SubscriptionService);
  private readonly bookings = inject(BookingService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly trails = trailPool(inject(CatalogService), inject(TrailService))
    .sort((a, b) => a.name.localeCompare(b.name));
  readonly today = todayKey();

  readonly unlocked = computed(() => this.subscriptions.has('saveItineraries'));
  readonly itineraries = this.service.itineraries;
  readonly count = this.service.count;
  readonly limit = this.service.limit;
  readonly canCreate = this.service.canCreate;
  readonly upcoming = computed(() =>
    this.bookings.bookings().filter((b) => b.date >= this.today && b.status !== 'cancelled').slice(0, 5),
  );

  readonly creating = signal(false);
  newTrailId = '';
  newDate = '';
  newTitle = '';

  constructor() {
    addIcons({ addOutline, arrowBackOutline, calendarOutline, chevronForwardOutline, mapOutline, trashOutline });
  }

  goBack() {
    if (window.history.length > 1) this.location.back();
    else void this.router.navigate(['/tabs/profile']);
  }

  fromBooking(id: string) {
    const b = this.bookings.byId(id);
    if (!b) return;
    this.newTrailId = b.trailId;
    this.newDate = b.date;
    this.newTitle = `${b.trailName} · #${b.reference}`;
  }

  async create() {
    const t = this.trails.find((x) => x.id === this.newTrailId);
    if (!t) return;
    const ref = this.upcoming().find((b) => b.trailId === t.id && b.date === this.newDate)?.reference ?? null;
    try {
      const it = await this.service.create({
        trailId: t.id, trailName: t.name, date: this.newDate, title: this.newTitle, bookingRef: ref,
      });
      this.creating.set(false);
      this.newTrailId = this.newDate = this.newTitle = '';
      void this.router.navigate(['/itineraries', it.id]);
    } catch (e) {
      void this.toast(e instanceof Error ? e.message : 'Could not save the itinerary.');
    }
  }

  open(it: Itinerary) {
    void this.router.navigate(['/itineraries', it.id]);
  }

  async remove(ev: Event, it: Itinerary) {
    ev.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Delete itinerary?',
      message: `"${it.title}" will be removed.`,
      buttons: [
        { text: 'Keep', role: 'cancel' },
        { text: 'Delete', role: 'destructive', handler: () => { void this.service.remove(it.id); } },
      ],
    });
    await alert.present();
  }

  private async toast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color: 'dark' });
    await t.present();
  }
}

// ── Editor ───────────────────────────────────────────────────────────────

@Component({
  selector: 'app-itinerary-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonIcon, LockedFeatureComponent],
  template: `
    <ion-content [fullscreen]="true">
      <div class="it-top">
        <button class="it-back" (click)="goBack()" aria-label="Go back"><ion-icon name="arrow-back-outline"></ion-icon></button>
        <h1>Itinerary</h1>
        <span class="it-pill" *ngIf="it">{{ saved() ? 'Saved' : 'Saving…' }}</span>
      </div>

      <div class="it-body" *ngIf="!it">
        <p class="it-dim">This itinerary was not found. It may have been deleted.</p>
      </div>

      <div class="it-body" *ngIf="it">
        <div class="it-card">
          <label class="it-field"><span>Name</span>
            <input type="text" maxlength="60" [(ngModel)]="it.title" (ngModelChange)="changed()" />
          </label>
          <p class="it-dim"><ion-icon name="map-outline"></ion-icon> {{ it.trailName }}<ng-container *ngIf="it.bookingRef"> · booking #{{ it.bookingRef }}</ng-container></p>
          <label class="it-field" style="margin-top:10px"><span>Hike date</span>
            <input type="date" [(ngModel)]="it.date" (ngModelChange)="changed()" />
          </label>
        </div>

        <!-- Days -->
        <div *ngFor="let day of it.days; let d = index" class="it-day">
          <p class="it-h">
            <ion-icon name="calendar-outline"></ion-icon>
            {{ it.days.length > 1 ? 'Day ' + (d + 1) : 'Plan for the day' }}
            <span class="it-daydate" *ngIf="dayDate(d)">{{ dayDate(d) | date: 'EEE, MMM d' }}</span>
            <button class="it-icon-btn" *ngIf="it.days.length > 1" (click)="removeDay(d)" aria-label="Remove day"><ion-icon name="trash-outline"></ion-icon></button>
          </p>
          <div class="it-card">
            <div class="it-stop" *ngFor="let s of day.stops; let i = index">
              <input class="it-input time" type="time" [(ngModel)]="s.time" (ngModelChange)="changed()" aria-label="Time" />
              <input class="it-input" type="text" maxlength="80" [(ngModel)]="s.title" (ngModelChange)="changed()" placeholder="What happens" aria-label="Plan step" />
              <button class="it-icon-btn" (click)="removeStop(d, i)" aria-label="Remove step"><ion-icon name="close-outline"></ion-icon></button>
            </div>
            <button class="it-link" (click)="addStop(d)"><ion-icon name="add-outline"></ion-icon> Add a step</button>
          </div>
        </div>

        <ng-container *ngIf="tools(); else toolsLocked">
          <button class="it-btn ghost it-wide" (click)="addDay()" [disabled]="it.days.length >= 7">
            <ion-icon name="add-outline"></ion-icon> Add a day (multi-day trip)
          </button>

          <!-- Group -->
          <p class="it-h"><ion-icon name="people-outline"></ion-icon> Group ({{ it.members.length }})</p>
          <div class="it-card">
            <div class="it-member" *ngFor="let m of it.members; let i = index">
              <input class="it-input" type="text" maxlength="40" [(ngModel)]="m.name" (ngModelChange)="changed()" placeholder="Name" aria-label="Name" />
              <input class="it-input" type="text" maxlength="30" [(ngModel)]="m.role" (ngModelChange)="changed()" placeholder="Role (e.g. sweeper)" aria-label="Role" />
              <input class="it-input" type="text" maxlength="40" [(ngModel)]="m.contact" (ngModelChange)="changed()" placeholder="Phone or email" aria-label="Contact" />
              <button class="it-icon-btn" (click)="removeMember(i)" aria-label="Remove person"><ion-icon name="close-outline"></ion-icon></button>
            </div>
            <p class="it-dim" *ngIf="!it.members.length">Add the people going so you can share out the group gear.</p>
            <button class="it-link" (click)="addMember()" [disabled]="it.members.length >= 30"><ion-icon name="add-outline"></ion-icon> Add a person</button>
          </div>

          <!-- Shared gear -->
          <p class="it-h"><ion-icon name="checkmark"></ion-icon> Shared group gear ({{ packedCount() }} of {{ it.gear.length }} packed)</p>
          <div class="it-card">
            <div class="it-gear" *ngFor="let g of it.gear; let i = index">
              <button class="it-check" [class.on]="g.packed" (click)="g.packed = !g.packed; changed()" [attr.aria-pressed]="g.packed" aria-label="Packed">
                <ion-icon name="checkmark" *ngIf="g.packed"></ion-icon>
              </button>
              <input class="it-input" type="text" maxlength="50" [(ngModel)]="g.text" (ngModelChange)="changed()" aria-label="Gear item" />
              <select class="it-input who" [(ngModel)]="g.memberId" (ngModelChange)="changed()" aria-label="Who brings it">
                <option [ngValue]="null">Who brings it?</option>
                <option *ngFor="let m of it.members" [ngValue]="m.id">{{ m.name || 'Unnamed' }}</option>
              </select>
              <button class="it-icon-btn" (click)="removeGear(i)" aria-label="Remove item"><ion-icon name="close-outline"></ion-icon></button>
            </div>
            <div class="it-row">
              <button class="it-link" (click)="addGear()"><ion-icon name="add-outline"></ion-icon> Add an item</button>
              <button class="it-link" *ngIf="!it.gear.length" (click)="addSuggestedGear()"><ion-icon name="add-outline"></ion-icon> Add suggested group gear</button>
            </div>
          </div>
        </ng-container>
        <ng-template #toolsLocked>
          <app-locked-feature feature="tripTools" title="Trip-management tools"
            text="Plan multi-day trips, keep your group's names and contacts, and share out the group gear with a checklist everyone can see."></app-locked-feature>
        </ng-template>

        <p class="it-h">Notes</p>
        <textarea class="it-input it-notes" rows="3" maxlength="600" [(ngModel)]="it.notes" (ngModelChange)="changed()"
          placeholder="Meeting point, transport, budget, reminders…"></textarea>

        <button class="it-btn it-wide" (click)="share()"><ion-icon name="share-social-outline"></ion-icon> Share with your group</button>
      </div>
    </ion-content>
  `,
  styles: [SHARED_STYLES + `
    .it-wide { width: 100%; margin-top: 12px; }
    .it-row { display: flex; gap: 14px; flex-wrap: wrap; }
    .it-daydate { margin-left: auto; font-size: 12px; font-weight: 500; color: var(--app-text-dim); }
    .it-stop, .it-gear, .it-member { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
    .it-member { flex-wrap: wrap; padding-bottom: 8px; border-bottom: 1px solid var(--app-border); }
    .it-member .it-input { flex: 1 1 30%; min-width: 120px; }
    .it-input { flex: 1; min-width: 0; min-height: 38px; padding: 6px 10px; }
    .it-input.time { flex: 0 0 104px; }
    .it-input.who { flex: 0 0 120px; }
    .it-notes { width: 100%; }
    .it-check { width: 26px; height: 26px; flex-shrink: 0; border-radius: 8px; border: 1.5px solid var(--app-border-strong); background: transparent; display: grid; place-items: center; color: var(--app-on-accent, #161d18); }
    .it-check.on { background: var(--app-accent); border-color: var(--app-accent); }
  `],
})
export class ItineraryEditorPage implements OnDestroy {
  private readonly service = inject(ItineraryService);
  private readonly subscriptions = inject(SubscriptionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toastCtrl = inject(ToastController);

  /** A working copy; every edit is saved shortly after. */
  it: Itinerary | null = null;
  readonly saved = signal(true);
  readonly tools = computed(() => this.subscriptions.has('tripTools'));
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    addIcons({ addOutline, arrowBackOutline, calendarOutline, checkmark, closeOutline, mapOutline, peopleOutline, shareSocialOutline, trashOutline });
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    void this.service.ready.then(() => {
      const found = this.service.byId(id);
      this.it = found ? (JSON.parse(JSON.stringify(found)) as Itinerary) : null;
    });
  }

  ngOnDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      void this.flush();
    }
  }

  goBack() {
    if (window.history.length > 1) this.location.back();
    else void this.router.navigate(['/itineraries']);
  }

  packedCount(): number {
    return this.it?.gear.filter((g) => g.packed).length ?? 0;
  }

  /** The calendar date of day N, from the hike date. */
  dayDate(n: number): Date | null {
    if (!this.it?.date) return null;
    const [y, m, d] = this.it.date.split('-').map(Number);
    return new Date(y, m - 1, d + n);
  }

  changed() {
    this.saved.set(false);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 500);
  }

  private async flush() {
    this.timer = undefined;
    if (!this.it) return;
    await this.service.update(this.it);
    this.saved.set(true);
  }

  addStop(d: number) {
    this.it?.days[d].stops.push({ id: newId('s'), time: '', title: '', note: '' });
    this.changed();
  }

  removeStop(d: number, i: number) {
    this.it?.days[d].stops.splice(i, 1);
    this.changed();
  }

  addDay() {
    if (!this.it || !this.tools() || this.it.days.length >= 7) return;
    this.it.days.push(defaultDay(false));
    this.changed();
  }

  removeDay(d: number) {
    this.it?.days.splice(d, 1);
    this.changed();
  }

  addMember() {
    if (!this.tools()) return;
    this.it?.members.push({ id: newId('m'), name: '', contact: '', role: '' });
    this.changed();
  }

  removeMember(i: number) {
    if (!this.it) return;
    const [gone] = this.it.members.splice(i, 1);
    this.it.gear.forEach((g) => { if (g.memberId === gone?.id) g.memberId = null; });
    this.changed();
  }

  addGear() {
    if (!this.tools()) return;
    this.it?.gear.push({ id: newId('g'), text: '', memberId: null, packed: false });
    this.changed();
  }

  addSuggestedGear() {
    if (!this.it || !this.tools()) return;
    this.it.gear.push(...SUGGESTED_GROUP_GEAR.map((text) => ({ id: newId('g'), text, memberId: null, packed: false })));
    this.changed();
  }

  removeGear(i: number) {
    this.it?.gear.splice(i, 1);
    this.changed();
  }

  async share() {
    if (!this.it) return;
    await this.flush();
    const text = this.service.shareText(this.it);
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (nav.share) await nav.share({ title: this.it.title, text });
      else {
        await navigator.clipboard.writeText(text);
        void this.toast('Itinerary copied. Paste it in your group chat.');
      }
    } catch {
      // Share sheet closed.
    }
  }

  private async toast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color: 'dark' });
    await t.present();
  }
}
