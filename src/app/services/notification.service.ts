import { Injectable, computed, inject } from '@angular/core';
import { FollowAlertsService } from './follow-alerts.service';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  /** New posts from people you follow (built from the community feed). */
  private readonly followAlerts = inject(FollowAlertsService);

  /** Everything, newest first. */
  readonly notifications = computed(() =>
    [...this.followAlerts.alerts()]
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
  );
  readonly unreadCount = computed(() => this.notifications().filter(n => !n.read).length);

  markAsRead(id: string) {
    this.followAlerts.markRead(id);
  }

  markAllRead() {
    this.followAlerts.markAllRead();
  }
}
