/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PERMIT OFFICE NOTIFICATIONS — the bell on /office
 *
 * Built from OfficeDataService's live queue (bookings TrailBound has sent,
 * permitLodged == true), so it only ever knows what firestore.rules already
 * lets an officer read. Everything here is something TrailBound's admin did,
 * or a deadline coming up:
 *
 *   new application      TrailBound sent one for a decision
 *   decision needed soon still waiting, and the hike is three days away or less
 *   withdrawn            TrailBound cancelled the booking; nothing to decide
 *
 * The office's own decisions (issue, refuse) are not repeated back.
 * Read marks are remembered on this device, per officer account.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Injectable, computed, inject } from '@angular/core';
import { addIcons } from 'ionicons';
import { closeCircleOutline, hourglassOutline, ribbonOutline } from 'ionicons/icons';
import { OfficeDataService } from './office-data.service';
import type { AppNotification } from '../../../models/notification.model';
import {
  type NoteInput, NotificationReadState, buildFeed, daysUntil, minuteClock, shortDay, startOfToday,
} from '../../../services/notification.util';

/** "Decision needed soon" starts this many days before the hike. */
const SOON_DAYS = 3;

@Injectable({ providedIn: 'root' })
export class OfficeNotificationsService {
  private readonly office = inject(OfficeDataService);
  private readonly readState = new NotificationReadState('tba.office.notifications.read');
  private readonly clock = minuteClock();

  readonly notifications = computed<AppNotification[]>(() => {
    const now = this.clock();
    const events: NoteInput[] = [];

    for (const a of this.office.applications()) {
      const link = { path: '/office', queryParams: { open: a.id } };
      const on = a.date ? ` on ${shortDay(a.date)}` : '';
      const group = `${a.headcount} hiker${a.headcount === 1 ? '' : 's'}`;

      events.push({
        id: `o-${a.id}-lodged`, at: a.lodgedAt,
        type: 'permit', tone: 'accent', icon: 'ribbon-outline',
        title: 'New permit application',
        message: `${a.trailName}${on} · ${a.hikerName || 'A hiker'} · ${group}. Sent by TrailBound (#${a.reference}).`,
        link,
      });

      if (a.status === 'cancelled') {
        events.push({
          id: `o-${a.id}-withdrawn`, at: a.lodgedAt,
          type: 'permit', tone: 'danger', icon: 'close-circle-outline',
          title: 'Application withdrawn',
          message: `TrailBound cancelled #${a.reference} (${a.trailName}${on}). No decision is needed.`,
          link,
        });
        continue;
      }

      const days = a.paperwork === 'permit_pending' ? daysUntil(a.date, new Date(now)) : null;
      if (days !== null && days >= 0 && days <= SOON_DAYS) {
        events.push({
          id: `o-${a.id}-soon-${a.date}`, at: startOfToday(new Date(now)),
          type: 'reminder', tone: 'warning', icon: 'hourglass-outline',
          title: 'Decision needed soon',
          message: `${a.trailName} for ${a.hikerName || 'a hiker'} is ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`} and still waiting on your decision.`,
          link,
        });
      }
    }

    return buildFeed(events, this.readState.read(), now);
  });

  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);

  constructor() {
    addIcons({ closeCircleOutline, hourglassOutline, ribbonOutline });
  }

  markRead(id: string): void {
    this.readState.mark([id]);
  }

  markAllRead(): void {
    this.readState.mark(this.notifications().map((n) => n.id));
  }
}
