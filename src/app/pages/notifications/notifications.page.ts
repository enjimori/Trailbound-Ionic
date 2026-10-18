import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonIcon, IonButtons, IonButton, IonTitle,
} from '@ionic/angular/standalone';
import { NotificationService } from '../../services/notification.service';
import { AppNotification } from '../../models/notification.model';

@Component({
  selector: 'app-notifications',
  standalone: true,
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  imports: [
    CommonModule, IonContent, IonHeader, IonToolbar, IonIcon, IonButtons,
    IonButton, IonTitle,
  ],
})
export class NotificationsPage {
  constructor(
    public notificationService: NotificationService,
    private location: Location,
    private router: Router,
  ) {}

  goBack() {
    this.location.back();
  }

  onTapNotification(n: AppNotification) {
    this.notificationService.markAsRead(n.id);
    if (n.postId) {
      this.router.navigate(['/tabs/community'], { queryParams: { post: n.postId } });
    }
  }

  markAllRead() {
    this.notificationService.markAllRead();
  }
}
