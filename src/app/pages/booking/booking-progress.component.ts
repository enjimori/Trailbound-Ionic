/**
 * The booking tracker — where a hike stands, as a vertical timeline.
 *
 * Purely presentational. All of the reasoning lives in bookingProgress() in
 * booking-workflow.ts, so this component cannot disagree with the admin panel
 * about what state a booking is in.
 *
 * ── THE STEPS ARE NOT A FIXED LIST ────────────────────────────────────────
 * They come from the trail's own requirements. A trail that wants a medical
 * certificate shows that step; one that does not has fewer steps rather than
 * a permanently greyed-out row the hiker has to work out is irrelevant. Same
 * for the permit: an open-access trail has no permit step.
 *
 * ── WHY ONE STEP IS "CURRENT" ─────────────────────────────────────────────
 * Exactly one step is highlighted at a time, and a blocked step says what the
 * hiker has to do about it. The question this screen answers is "what is
 * happening to my booking, and is it waiting on me?" — a row of equally
 * weighted bullets does not answer it.
 *
 * Usage:
 *   <app-booking-progress [steps]="progress()"></app-booking-progress>
 *
 * where progress() calls bookingProgress() with the booking's workflow fields
 * and permitFor(trailName).
 */
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alertCircle, checkmarkCircle, ellipseOutline, timeOutline,
} from 'ionicons/icons';
import type { ProgressStep } from '../../models/booking-workflow';

@Component({
  selector: 'app-booking-progress',
  standalone: true,
  imports: [CommonModule, IonIcon],
  template: `
    <ol class="track">
      <li *ngFor="let s of steps; let last = last" [attr.data-state]="s.state" [class.last]="last">
        <span class="mark">
          <ion-icon [name]="icon(s.state)"></ion-icon>
        </span>
        <div class="body">
          <b>{{ s.title }}</b>
          <small>{{ s.detail }}</small>
        </div>
      </li>
    </ol>
  `,
  styles: [`
    .track {
      list-style: none;
      margin: 0;
      padding: 0;
      position: relative;
    }

    li {
      position: relative;
      display: flex;
      gap: 13px;
      padding-bottom: 20px;
    }
    li.last { padding-bottom: 0; }

    /* The connector runs from each marker to the next, so the last step has
       none. Drawn per-item rather than as one spine behind the list, so it
       can take the colour of the step it leaves. */
    li:not(.last)::before {
      content: '';
      position: absolute;
      left: 12px;
      top: 26px;
      bottom: 4px;
      width: 2px;
      background: var(--app-border-strong, rgba(238, 240, 231, 0.14));
    }
    li[data-state='done']:not(.last)::before {
      background: color-mix(in srgb, #7fd09a 45%, transparent);
    }

    .mark {
      flex: none;
      width: 26px;
      height: 26px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: var(--app-bg, #0d1511);
      border: 2px solid var(--app-border-strong, rgba(238, 240, 231, 0.14));
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
      font-size: 14px;
      z-index: 1;
    }

    .body { min-width: 0; padding-top: 2px; }
    b {
      display: block;
      font-size: 14.5px;
      font-weight: 600;
      color: var(--app-text, #eef0e7);
    }
    small {
      display: block;
      margin-top: 3px;
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }

    /* ── states ── */

    li[data-state='done'] .mark {
      border-color: #7fd09a;
      color: #7fd09a;
    }

    /* The one thing happening right now, and the only step that gets weight. */
    li[data-state='current'] .mark {
      border-color: var(--app-accent, #8fbf6a);
      background: var(--app-accent, #8fbf6a);
      color: var(--app-on-accent, #0d1511);
    }
    li[data-state='current'] b { color: var(--app-accent, #8fbf6a); }
    li[data-state='current'] small { color: var(--app-text, #eef0e7); }

    /* Waiting on the hiker, or refused. Red because it needs them to act. */
    li[data-state='blocked'] .mark {
      border-color: var(--ion-color-danger, #f0505a);
      color: var(--ion-color-danger, #f0505a);
    }
    li[data-state='blocked'] b { color: var(--ion-color-danger, #f0505a); }
    li[data-state='blocked'] small { color: var(--app-text, #eef0e7); }

    li[data-state='upcoming'] b { color: var(--app-text-dim, rgba(238, 240, 231, 0.6)); }

    @media (prefers-reduced-motion: no-preference) {
      li[data-state='current'] .mark { animation: pulse 2.4s ease-in-out infinite; }
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--app-accent, #8fbf6a) 45%, transparent); }
      50% { box-shadow: 0 0 0 6px transparent; }
    }
  `],
})
export class BookingProgressComponent {
  @Input({ required: true }) steps: ProgressStep[] = [];

  constructor() {
    addIcons({ alertCircle, checkmarkCircle, ellipseOutline, timeOutline });
  }

  icon(state: ProgressStep['state']): string {
    switch (state) {
      case 'done': return 'checkmark-circle';
      case 'current': return 'time-outline';
      case 'blocked': return 'alert-circle';
      default: return 'ellipse-outline';
    }
  }
}
