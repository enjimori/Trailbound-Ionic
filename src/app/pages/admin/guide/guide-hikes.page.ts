/**
 * GUIDE — my hikes.
 *
 * What a guide needs and nothing more: which hikes are assigned, when, who is
 * coming, and a way to record at the trailhead whether they turned up.
 *
 * What is deliberately absent: prices, deposits, balances, medical
 * certificates, permit references, other guides' hikes. A guide leads people
 * up a mountain. The money belongs to TrailBound and the health data belongs
 * to the issuing office, and firestore.rules refuses this account both.
 *
 * A booking still at 'pending' shows here but cannot be marked off, because it
 * is not confirmed and may yet not happen. Saying so plainly is better than
 * hiding it — a guide seeing their Saturday half-arranged is useful.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, calendarOutline, checkmarkDoneOutline, closeCircleOutline,
  hourglassOutline, mailOutline, mapOutline, peopleOutline, saveOutline,
} from 'ionicons/icons';
import { GuideDataService, type GuideHike } from './guide-data.service';
import { AdminUiService } from '../admin-ui.service';
import { dayKey, fromDayKey } from '../admin-utils';
import { allTrails } from '../../explore/trail-lookup';
import { TrailService } from '../../../services/trail.service';
import {
  type AttendanceMark, type Participant, MAX_GUIDE_GUESTS, guestCount, participantsOf, summarize,
} from '../../../models/guide-ops.model';

type Tab = 'upcoming' | 'past' | 'hikers';

@Component({
  selector: 'app-guide-hikes',
  standalone: true,
  imports: [DatePipe, FormsModule, IonIcon, NgTemplateOutlet],
  template: `
    <div class="tba-head">
      <div>
        <h1>{{ guide.guideName() ? 'Hello, ' + guide.guideName() : 'My hikes' }}</h1>
        <p>
          @if (guide.today().length) {
            {{ guide.today().length }} {{ guide.today().length === 1 ? 'hike' : 'hikes' }} today ·
          }
          {{ guide.upcoming().length }} coming up
        </p>
      </div>
    </div>

    @if (guide.error(); as err) {
      <div class="tba-alert flat"><ion-icon name="alert-circle-outline"></ion-icon><p>{{ err }}</p></div>
    }

    <!-- ── availability & capacity (guide_status/{rosterId}) ─────────────── -->
    @if (guide.rosterId()) {
      <div class="tba-card avail">
        <div class="avail-text">
          <b>Your availability</b>
          <small>
            Hikers can only pick you on your mountains while you are Available, and a group larger than your limit cannot book you.
            TrailBound will not confirm more hikers on one date than your limit.
          </small>
        </div>
        <div class="avail-controls">
          <div class="tba-chips" role="group" aria-label="Availability">
            <button type="button" [class.on]="shownAvailable()" (click)="editAvailable.set(true)">Available</button>
            <button type="button" [class.on]="!shownAvailable()" (click)="editAvailable.set(false)">Unavailable</button>
          </div>
          <label class="tba-field max-field">
            <span>Max guests per hike date</span>
            <input class="tba-input-box" type="number" min="1" [max]="maxGuestsCap" inputmode="numeric"
                   placeholder="No limit" [ngModel]="shownMax()" (ngModelChange)="editMax.set($event)" />
          </label>
          <button type="button" class="tba-btn primary" [disabled]="busy() || !statusDirty()" (click)="saveStatus()">
            <ion-icon name="save-outline"></ion-icon>Save
          </button>
        </div>
        <p class="avail-now">
          Mountains: <b>{{ mountainsLabel() }}</b>
          <span class="set-by">Set by TrailBound</span>
        </p>
        <p class="avail-now">
          Now: <b>{{ guide.status().available ? 'Available' : 'Unavailable' }}</b>
          · {{ guide.status().maxGuests ? 'up to ' + guide.status().maxGuests + ' guests per date' : 'no guest limit' }}
          @if (guide.status().updatedAt) { · saved {{ guide.status().updatedAt | date: 'MMM d, h:mm a' }} }
        </p>
      </div>
    }

    @if (guide.today().length) {
      <p class="tba-section-title">Today</p>
      @for (h of guide.today(); track h.id) {
        <div class="hike now">
          <ng-container *ngTemplateOutlet="card; context: { $implicit: h }"></ng-container>
        </div>
      }
    }

    <div class="tba-toolbar">
      <div class="tba-chips">
        @for (t of tabs; track t.id) {
          <button type="button" [class.on]="tab() === t.id" (click)="tab.set(t.id)">
            {{ t.label }}<em>{{ t.id === 'upcoming' ? guide.upcoming().length : t.id === 'past' ? guide.past().length : rosterHikes().length }}</em>
          </button>
        }
      </div>
    </div>

    @if (tab() === 'hikers') {
      <!-- ── hikers & attendance ──────────────────────────────────────── -->
      @for (h of rosterHikes(); track h.id) {
        <div class="tba-card roster">
          <div class="top">
            <img class="tba-thumb big" [src]="h.trailImage" alt="" (error)="hideImg($event)" />
            <div class="what">
              <b>{{ h.trailName }}</b>
              <small>#{{ h.reference }} · {{ hikeDate(h) | date: 'EEE, MMM d, y' }}</small>
              <small>{{ people(h).length }} {{ people(h).length === 1 ? 'hiker' : 'hikers' }} · {{ dayLoad(h) }}</small>
            </div>
            <span class="tba-badge" [attr.data-tone]="tone(h)">{{ label(h) }}</span>
          </div>

          <div class="tba-table-wrap">
            <table class="tba-table att">
              <thead>
                <tr><th class="idx">#</th><th>Hiker</th><th class="hide-sm">Emergency contact</th><th class="mark-col">Attendance</th></tr>
              </thead>
              <tbody>
                @for (p of people(h); track p.key; let i = $index) {
                  <tr>
                    <td class="muted idx">{{ i + 1 }}</td>
                    <td>
                      <b>{{ p.name }}</b>
                      @if (i === 0) { <small class="sub">{{ bookerLine(h, p) }}</small> }
                      @if (p.contact) { <small class="sub contact-sm">{{ p.contact }}</small> }
                    </td>
                    <td class="hide-sm muted">{{ p.contact || '—' }}</td>
                    <td class="mark-col">
                      @if (canMark(h)) {
                        <div class="att-toggle" role="group" [attr.aria-label]="'Attendance for ' + p.name">
                          <button type="button" class="present" [class.on]="markOf(h, p) === 'present'"
                                  [attr.aria-pressed]="markOf(h, p) === 'present'" (click)="setMark(h, p, 'present')">Present</button>
                          <button type="button" class="absent" [class.on]="markOf(h, p) === 'absent'"
                                  [attr.aria-pressed]="markOf(h, p) === 'absent'" (click)="setMark(h, p, 'absent')">Absent</button>
                        </div>
                      } @else if (savedMark(h, p)) {
                        <span class="tba-badge" [attr.data-tone]="savedMark(h, p) === 'present' ? 'green' : 'red'">{{ savedMark(h, p) === 'present' ? 'Present' : 'Absent' }}</span>
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          @if (canMark(h)) {
            <div class="acts">
              <button type="button" class="tba-btn" [disabled]="busy()" (click)="markAllPresent(h)">
                <ion-icon name="checkmark-done-outline"></ion-icon>Mark all present
              </button>
              <button type="button" class="tba-btn primary" [disabled]="busy() || !attendanceDirty(h)" (click)="saveAttendance(h)">
                <ion-icon name="save-outline"></ion-icon>Save attendance
              </button>
            </div>
          } @else {
            <p class="waiting">
              <ion-icon name="hourglass-outline"></ion-icon>
              {{ h.status === 'pending'
                ? 'Attendance opens once TrailBound confirms this hike.'
                : 'Attendance opens on the hike day, ' + (hikeDate(h) | date: 'MMM d') + '.' }}
            </p>
          }

          @if (guide.attendance()[h.id]; as rec) {
            <p class="saved-line">
              Saved: {{ summaryOf(h).present }} present, {{ summaryOf(h).absent }} absent
              @if (rec.updatedAt) { · {{ rec.updatedAt | date: 'MMM d, h:mm a' }} }
            </p>
            <!-- Closing the booking uses the existing "They hiked" / "No-show" actions. -->
            @if (h.status === 'confirmed' && !attendanceDirty(h)) {
              <div class="close-out">
                @if (summaryOf(h).present === 0) {
                  <span>Everyone was marked absent.</span>
                  <button type="button" class="tba-btn sm danger" [disabled]="busy()" (click)="noShow(h)">
                    <ion-icon name="close-circle-outline"></ion-icon>Record no-show
                  </button>
                } @else {
                  <span>Attendance is saved. Close the booking when the hike is done.</span>
                  <button type="button" class="tba-btn sm primary" [disabled]="busy()" (click)="complete(h)">
                    <ion-icon name="checkmark-done-outline"></ion-icon>They hiked
                  </button>
                }
              </div>
            }
          }
        </div>
      } @empty {
        <div class="tba-card">
          <div class="tba-empty">
            <ion-icon name="people-outline"></ion-icon>
            <h3>No hikers assigned yet</h3>
            <p>Hikers who book you appear here, one list per hike.</p>
          </div>
        </div>
      }
    } @else if (shown().length) {
      @for (h of shown(); track h.id) {
        <div class="hike">
          <ng-container *ngTemplateOutlet="card; context: { $implicit: h }"></ng-container>
        </div>
      }
    } @else {
      <div class="tba-card">
        <div class="tba-empty">
          <ion-icon name="map-outline"></ion-icon>
          <h3>{{ tab() === 'upcoming' ? 'No hikes coming up' : 'Nothing here yet' }}</h3>
          <p>
            {{ tab() === 'upcoming'
              ? 'A hike appears here as soon as a hiker picks you and TrailBound arranges it.'
              : 'Hikes you have led will be listed here.' }}
          </p>
        </div>
      </div>
    }

    <!-- ── one hike ─────────────────────────────────────────────────────── -->
    <ng-template #card let-h>
      <div class="tba-card">
        <div class="top">
          <img class="tba-thumb big" [src]="h.trailImage" alt="" (error)="hideImg($event)" />
          <div class="what">
            <b>{{ h.trailName }}</b>
            <small>#{{ h.reference }} · {{ h.packageName }}</small>
            @if (h.activityNames.length) { <small>{{ h.activityNames.join(', ') }}</small> }
          </div>
          <span class="tba-badge" [attr.data-tone]="tone(h)">{{ label(h) }}</span>
        </div>

        <dl class="tba-dl">
          <div>
            <dt><ion-icon name="calendar-outline"></ion-icon> Date</dt>
            <dd>{{ hikeDate(h) | date: 'EEEE, MMM d, y' }}</dd>
          </div>
          <div>
            <dt><ion-icon name="people-outline"></ion-icon> Hiker</dt>
            <dd>{{ h.hikerName || '—' }}</dd>
          </div>
          <div>
            <dt><ion-icon name="mail-outline"></ion-icon> Contact</dt>
            <dd><a [href]="'mailto:' + h.hikerEmail">{{ h.hikerEmail || '—' }}</a></dd>
          </div>
        </dl>

        @if (h.status === 'pending') {
          <p class="waiting">
            <ion-icon name="hourglass-outline"></ion-icon>
            TrailBound is still arranging this one. It is not confirmed yet, so do not travel for it.
          </p>
        } @else if (h.status === 'confirmed' && h.date <= todayKey) {
          <div class="acts">
            <button type="button" class="tba-btn primary" [disabled]="busy()" (click)="complete(h)">
              <ion-icon name="checkmark-done-outline"></ion-icon>They hiked
            </button>
            <button type="button" class="tba-btn danger" [disabled]="busy()" (click)="noShow(h)">
              <ion-icon name="close-circle-outline"></ion-icon>No-show
            </button>
          </div>
        }
      </div>
    </ng-template>
  `,
  styles: [`
    .hike { margin-bottom: 12px; }
    .hike.now .tba-card { border-color: var(--tba-sand); box-shadow: 0 0 0 3px var(--tba-sand-soft); }
    .top { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
    .tba-thumb.big { width: 56px; height: 56px; border-radius: 14px; }
    .what { min-width: 0; margin-right: auto; }
    .what b { display: block; font-size: 15px; font-weight: 700; }
    .what small { display: block; color: var(--tba-muted); font-size: 12px; margin-top: 2px; }
    .tba-dl { margin-bottom: 0; }
    .tba-dl dt { display: flex; align-items: center; gap: 7px; }
    .tba-dl dd a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
    .waiting { display: flex; align-items: center; gap: 8px; margin: 14px 0 0; padding: 10px 12px;
      border-radius: 10px; background: var(--tba-sand-soft); font-size: 12.5px; line-height: 1.5; }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .tba-alert.flat { margin: 0 0 16px; }
    .tba-btn[disabled] { opacity: .5; cursor: not-allowed; }

    /* availability */
    .avail { display: grid; gap: 12px; margin-bottom: 18px; }
    .avail-text b { display: block; font-size: 15px; font-weight: 700; }
    .avail-text small { display: block; color: var(--tba-muted); font-size: 12.5px; line-height: 1.5; margin-top: 3px; }
    .avail-controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
    .max-field { width: 190px; margin: 0; }
    .avail-now { margin: 0; color: var(--tba-muted); font-size: 12.5px; }
    .avail-now b { color: var(--tba-text); }
    .avail-now .set-by { margin-left: 6px; font-size: 11.5px; }

    /* hikers & attendance */
    .roster { margin-bottom: 12px; }
    .att th, .att td { vertical-align: middle; }
    .att small.sub { display: block; color: var(--tba-muted); font-size: 11.5px; margin-top: 2px; }
    .att .muted { color: var(--tba-muted); }
    .mark-col { text-align: right; white-space: nowrap; }
    .att-toggle { display: inline-flex; border: 1px solid var(--tba-line); border-radius: 999px; overflow: hidden; }
    .att-toggle button { border: 0; background: transparent; padding: 7px 13px; font-size: 12.5px; font-weight: 600; color: var(--tba-muted); }
    .att-toggle button + button { border-left: 1px solid var(--tba-line); }
    .att-toggle button.present.on { background: var(--tba-up); color: #fff; }
    .att-toggle button.absent.on { background: var(--tba-down); color: #fff; }
    .saved-line { margin: 12px 0 0; color: var(--tba-muted); font-size: 12.5px; }
    .close-out { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 10px; padding: 10px 12px;
      border-radius: 10px; background: var(--tba-soft); font-size: 12.5px; }
    .close-out span { margin-right: auto; }
    /* On phones the emergency-contact column is hidden, so the contact moves under the name. */
    .att small.sub.contact-sm { display: none; }
    @media (max-width: 599px) {
      .hide-sm, .att .idx { display: none; }
      .att small.sub.contact-sm { display: block; }
      .att td:nth-child(2) { white-space: normal; word-break: break-word; }
      .att-toggle button { padding: 6px 9px; font-size: 12px; }
    }
  `],
})
export class GuideHikesPage {
  readonly guide = inject(GuideDataService);
  private readonly ui = inject(AdminUiService);

  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
    { id: 'hikers', label: 'Hikers & attendance' },
  ];

  readonly tab = signal<Tab>('upcoming');
  readonly busy = signal(false);
  readonly todayKey = dayKey(new Date());

  readonly shown = computed(() =>
    this.tab() === 'upcoming' ? this.guide.upcoming() : this.guide.past(),
  );

  // ── availability ──────────────────────────────────────────────────────────

  readonly maxGuestsCap = MAX_GUIDE_GUESTS;

  private readonly trailService = inject(TrailService);

  /** The mountains TrailBound assigned this guide, by name. */
  readonly mountainsLabel = computed(() => {
    const ids = this.guide.trails();
    if (ids === null) return 'Any mountain';
    const byId = new Map([...allTrails(), ...this.trailService.addedTrails()].map((t) => [t.id, t.name]));
    return ids.map((id) => byId.get(id) ?? id).join(', ');
  });
  /** Unsaved edits; null = show what is saved. */
  readonly editAvailable = signal<boolean | null>(null);
  readonly editMax = signal<number | string | null>(null);

  readonly shownAvailable = computed(() => this.editAvailable() ?? this.guide.status().available);
  readonly shownMax = computed(() => {
    const e = this.editMax();
    return e !== null ? e : this.guide.status().maxGuests ?? '';
  });

  /** The limit as typed: a number, null for "no limit", or NaN when it is not a valid number. */
  private readonly typedMax = computed<number | null>(() => {
    const v = this.shownMax();
    if (v === '' || v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  });

  readonly statusDirty = computed(() =>
    this.shownAvailable() !== this.guide.status().available ||
    this.typedMax() !== this.guide.status().maxGuests,
  );

  // ── hikers & attendance ───────────────────────────────────────────────────

  /** Every hike with people to look after: coming up first, then past ones. Cancelled ones are left out. */
  readonly rosterHikes = computed(() => [
    ...this.guide.upcoming().filter((h) => h.status !== 'cancelled'),
    ...this.guide.past().filter((h) => h.status !== 'cancelled'),
  ]);

  /** Unsaved Present / Absent taps, by booking id then participant key. */
  private readonly drafts = signal<Record<string, Record<string, AttendanceMark>>>({});

  constructor() {
    addIcons({
      alertCircleOutline, calendarOutline, checkmarkDoneOutline, closeCircleOutline,
      hourglassOutline, mailOutline, mapOutline, peopleOutline, saveOutline,
    });
    void this.guide.start();
  }

  /** Saves availability and the guest limit. */
  async saveStatus(): Promise<void> {
    const max = this.typedMax();
    if (max !== null && (!Number.isInteger(max) || max < 1 || max > MAX_GUIDE_GUESTS)) {
      this.ui.toast(`Max guests must be a whole number from 1 to ${MAX_GUIDE_GUESTS}, or empty for no limit.`, 'error');
      return;
    }
    if (!(await this.run(() => this.guide.saveStatus(this.shownAvailable(), max), 'Availability saved'))) return;
    this.editAvailable.set(null);
    this.editMax.set(null);
  }

  /** Who this guide is responsible for on one hike. */
  people(h: GuideHike): Participant[] {
    return participantsOf({ userName: h.hikerName, groupHikers: h.groupHikers });
  }

  /** Contact for the person who booked, under the first name on the list. */
  bookerLine(h: GuideHike, p: Participant): string {
    if (!h.groupHikers.length) return h.hikerEmail;
    const booker = h.hikerName && h.hikerName !== p.name ? `Booked by ${h.hikerName}` : 'Booked the hike';
    return h.hikerEmail ? `${booker} · ${h.hikerEmail}` : booker;
  }

  /** Everyone booked with this guide on the same date, against their limit. */
  dayLoad(h: GuideHike): string {
    const total = this.guide.hikes()
      .filter((x) => x.date === h.date && (x.status === 'pending' || x.status === 'confirmed'))
      .reduce((n, x) => n + guestCount(x.groupHikers), 0);
    const max = this.guide.status().maxGuests;
    return `${total} booked with you that day` + (max ? ` (limit ${max})` : '');
  }

  /**
   * Attendance can be taken on or after the hike day once TrailBound has
   * confirmed — the same moment the existing "They hiked" / "No-show"
   * buttons appear — and corrected after the booking is closed.
   */
  canMark(h: GuideHike): boolean {
    if (h.status === 'completed' || h.status === 'no_show') return true;
    return h.status === 'confirmed' && h.date <= this.todayKey;
  }

  /** What is saved for this hiker, if anything. */
  savedMark(h: GuideHike, p: Participant): AttendanceMark | null {
    return this.guide.attendance()[h.id]?.entries[p.key]?.status ?? null;
  }

  /** What the checklist shows: an unsaved tap, else what is saved. */
  markOf(h: GuideHike, p: Participant): AttendanceMark | null {
    return this.drafts()[h.id]?.[p.key] ?? this.savedMark(h, p);
  }

  setMark(h: GuideHike, p: Participant, mark: AttendanceMark): void {
    this.drafts.update((d) => ({ ...d, [h.id]: { ...(d[h.id] ?? {}), [p.key]: mark } }));
  }

  markAllPresent(h: GuideHike): void {
    const all: Record<string, AttendanceMark> = {};
    for (const p of this.people(h)) all[p.key] = 'present';
    this.drafts.update((d) => ({ ...d, [h.id]: all }));
  }

  /** True when the checklist differs from what is saved. */
  attendanceDirty(h: GuideHike): boolean {
    const draft = this.drafts()[h.id];
    if (!draft) return false;
    return this.people(h).some((p) => (draft[p.key] ?? this.savedMark(h, p)) !== this.savedMark(h, p));
  }

  summaryOf(h: GuideHike) {
    return summarize(this.guide.attendance()[h.id]);
  }

  /** Writes the whole sheet. Every hiker must be marked first. */
  async saveAttendance(h: GuideHike): Promise<void> {
    const marks: Record<string, AttendanceMark> = {};
    for (const p of this.people(h)) {
      const m = this.markOf(h, p);
      if (!m) {
        this.ui.toast(`Mark ${p.name} present or absent first.`, 'error');
        return;
      }
      marks[p.key] = m;
    }
    if (!(await this.run(() => this.guide.saveAttendance(h, marks), 'Attendance saved'))) return;
    this.drafts.update((d) => {
      const next = { ...d };
      delete next[h.id];
      return next;
    });
  }

  /** Performs the hike date operation for this feature and returns its result to the caller. */
  hikeDate(h: GuideHike): Date | null {
    return h.date ? fromDayKey(h.date) : null;
  }

  /** Maps an internal value to the readable label shown in the interface. */
  label(h: GuideHike): string {
    switch (h.status) {
      case 'pending': return 'Being arranged';
      case 'completed': return 'Led';
      case 'cancelled': return 'Cancelled';
      case 'no_show': return 'No-show';
      default: return 'Confirmed';
    }
  }

  /** Maps a status value to the visual style used by the interface. */
  tone(h: GuideHike): string {
    switch (h.status) {
      case 'pending': return 'amber';
      case 'completed': return 'ink';
      case 'cancelled':
      case 'no_show': return 'red';
      default: return 'green';
    }
  }

  /** Performs the complete operation for this feature and returns its result to the caller. */
  async complete(h: GuideHike): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Record ${h.hikerName || 'this hiker'} as hiked?`,
      message: `${h.trailName} on ${h.date}. This closes the booking and lets them review the trail.`,
      confirmText: 'They hiked',
    });
    if (!ok) return;
    await this.run(() => this.guide.markCompleted(h), 'Recorded');
  }

  /** Performs the no show operation for this feature and returns its result to the caller. */
  async noShow(h: GuideHike): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Record a no-show?',
      message: `${h.hikerName || 'The hiker'} did not turn up for ${h.trailName}. TrailBound will see this and follow up — only record it once you have waited at the jump-off.`,
      confirmText: 'Record no-show',
      danger: true,
    });
    if (!ok) return;
    await this.run(() => this.guide.markNoShow(h), 'No-show recorded');
  }

  /** One write, with the busy flag and error handling every action shares. True when it saved. */
  private async run(write: () => Promise<void>, said: string): Promise<boolean> {
    this.busy.set(true);
    try {
      await write();
      this.ui.toast(said);
      return true;
    } catch (e) {
      this.ui.fail(e);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** Performs the hide img operation for this feature and returns its result to the caller. */
  hideImg(e: Event): void {
    (e.target as HTMLImageElement).style.visibility = 'hidden';
  }
}
