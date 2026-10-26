import { Injectable, computed, inject } from '@angular/core';
import { FollowAlertsService } from './follow-alerts.service';
import { HikerAlertsService } from './hiker-alerts.service';

/**
 * The hiker's notifications: the Notifications page, and the bell badges on
 * Home, Community and Profile.
 *
 *   FollowAlertsService   someone you follow posted
 *   HikerAlertsService    your bookings, permit and documents — what you did,
 *                         and what TrailBound, the permit office and your
 *                         guide did about it
 *
 * Staff have their own feeds in their own screens: AdminNotificationsService
 * (admin panel bell), GuideNotificationsService (/guide) and
 * OfficeNotificationsService (/office).
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  /** New posts from people you follow (built from the community feed). */
  private readonly followAlerts = inject(FollowAlertsService);
  /** Bookings, permit and documents (built from the hiker's own records). */
  private readonly hikerAlerts = inject(HikerAlertsService);

  /** Everything, newest first. */
  readonly notifications = computed(() =>
    [...this.hikerAlerts.alerts(), ...this.followAlerts.alerts()]
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
  );
  readonly unreadCount = computed(() => this.notifications().filter(n => !n.read).length);

  /** Marks the selected notification as read. */
  markAsRead(id: string) {
    if (this.hikerAlerts.owns(id)) this.hikerAlerts.markRead(id);
    else this.followAlerts.markRead(id);
  }

  /** Marks every currently available notification as read. */
  markAllRead() {
    this.hikerAlerts.markAllRead();
    this.followAlerts.markAllRead();
  }
}
