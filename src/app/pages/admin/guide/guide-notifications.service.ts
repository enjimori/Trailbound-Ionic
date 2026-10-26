/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GUIDE NOTIFICATIONS — the bell on /guide
 *
 * Built from GuideDataService's live list of this guide's hikes (bookings
 * whose guideId is their roster id), so it only ever knows what firestore.rules
 * already lets a guide read:
 *
 *   a hiker booked with you          new booking, still being arranged
 *   TrailBound confirmed / cancelled the hike is on, or off
 *   reminders                        the day before and the morning of
 *
 * What the guide records themselves (hiked, no-show) is not repeated back.
 * Read marks are remembered on this device, per guide account.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Injectable, computed, inject } from '@angular/core';
import { addIcons } from 'ionicons';
import {
  alarmOutline, calendarOutline, checkmarkCircleOutline, closeCircleOutline,
} from 'ionicons/icons';
import { GuideDataService } from './guide-data.service';
import type { AppNotification } from '../../../models/notification.model';
import {
  type NoteInput, NotificationReadState, buildFeed, daysUntil, minuteClock, shortDay, startOfToday,
} from '../../../services/notification.util';

@Injectable({ providedIn: 'root' })
export class GuideNotificationsService {
  private readonly guide = inject(GuideDataService);
  private readonly readState = new NotificationReadState('tba.guide.notifications.read');
  private readonly clock = minuteClock();

  readonly notifications = computed<AppNotification[]>(() => {
    const now = this.clock();
    const events: NoteInput[] = [];
    const link = { path: '/guide' };

    for (const h of this.guide.hikes()) {
      const who = h.hikerName || 'A hiker';
      const on = h.date ? ` on ${shortDay(h.date)}` : '';
      const changed = h.updatedAt ?? h.createdAt;

      events.push({
        id: `g-${h.id}-new`, at: h.createdAt,
        type: 'booking', tone: 'accent', icon: 'calendar-outline',
        title: 'New hike booked with you',
        message: `${who} · ${h.trailName}${on} · ${h.packageName}. TrailBound is arranging the permit; wait for confirmation.`,
        link,
      });

      if (h.status === 'confirmed') {
        events.push({
          id: `g-${h.id}-confirmed`, at: changed,
          type: 'booking', tone: 'success', icon: 'checkmark-circle-outline',
          title: 'Hike confirmed',
          message: `${h.trailName}${on} with ${who} (#${h.reference}). Meet them at the jump-off.`,
          link,
        });
      }

      if (h.status === 'cancelled') {
        events.push({
          id: `g-${h.id}-cancelled`, at: changed,
          type: 'booking', tone: 'danger', icon: 'close-circle-outline',
          title: 'Hike cancelled',
          message: `TrailBound cancelled ${who}'s ${h.trailName} hike${on} (#${h.reference}). You are free that day.`,
          link,
        });
      }

      const days = h.status === 'confirmed' ? daysUntil(h.date, new Date(now)) : null;
      if (days === 0 || days === 1) {
        events.push({
          id: `g-${h.id}-remind-${h.date}-${days}`, at: startOfToday(new Date(now)),
          type: 'reminder', tone: 'warning', icon: 'alarm-outline',
          title: days === 0 ? 'You are leading a hike today' : 'You are leading a hike tomorrow',
          message: `${h.trailName} with ${who}${h.activityNames.length ? ` · ${h.activityNames.join(', ')}` : ''}.`,
          link,
        });
      }
    }

    return buildFeed(events, this.readState.read(), now);
  });

  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);

  constructor() {
    addIcons({ alarmOutline, calendarOutline, checkmarkCircleOutline, closeCircleOutline });
  }

  markRead(id: string): void {
    this.readState.mark([id]);
  }

  markAllRead(): void {
    this.readState.mark(this.notifications().map((n) => n.id));
  }
}
