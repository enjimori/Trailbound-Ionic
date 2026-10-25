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
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, calendarOutline, checkmarkDoneOutline, closeCircleOutline,
  hourglassOutline, mailOutline, mapOutline, peopleOutline,
} from 'ionicons/icons';
import { GuideDataService, type GuideHike } from './guide-data.service';
import { AdminUiService } from '../admin-ui.service';
import { dayKey, fromDayKey } from '../admin-utils';

type Tab = 'upcoming' | 'past';

@Component({
  selector: 'app-guide-hikes',
  standalone: true,
  imports: [DatePipe, IonIcon, NgTemplateOutlet],
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
            {{ t.label }}<em>{{ t.id === 'upcoming' ? guide.upcoming().length : guide.past().length }}</em>
          </button>
        }
      </div>
    </div>

    @if (shown().length) {
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
  `],
})
export class GuideHikesPage {
  readonly guide = inject(GuideDataService);
  private readonly ui = inject(AdminUiService);

  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];

  readonly tab = signal<Tab>('upcoming');
  readonly busy = signal(false);
  readonly todayKey = dayKey(new Date());

  readonly shown = computed(() =>
    this.tab() === 'upcoming' ? this.guide.upcoming() : this.guide.past(),
  );

  constructor() {
    addIcons({
      alertCircleOutline, calendarOutline, checkmarkDoneOutline, closeCircleOutline,
      hourglassOutline, mailOutline, mapOutline, peopleOutline,
    });
    void this.guide.start();
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

  /** One write, with the busy flag and error handling both actions share. */
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

  /** Performs the hide img operation for this feature and returns its result to the caller. */
  hideImg(e: Event): void {
    (e.target as HTMLImageElement).style.visibility = 'hidden';
  }
}
