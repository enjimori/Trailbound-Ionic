import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonIcon, IonButtons, IonButton,
  AlertController, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { person } from 'ionicons/icons';
import { UserService } from '../../services/user.service';
import { NotificationService } from '../../services/notification.service';
import { UpcomingAdventure } from '../../models/user.model';

@Component({
  selector: 'app-profile',
  standalone: true,
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  imports: [
    CommonModule, IonContent, IonHeader, IonToolbar, IonTitle, IonIcon,
    IonButtons, IonButton,
  ],
})
export class ProfilePage {
  /**
   * False until Firebase has reported whether someone is signed in.
   * Prevents signed-in users from seeing the guest view flash on app start.
   */
  readonly authReady = signal(false);

  /** The signed-in user's profile, or null for guests. */
  readonly signedInProfile = computed(() =>
    this.userService.isAuthenticated() ? this.userService.profile() : null,
  );

  constructor(
    public userService: UserService,
    public notificationService: NotificationService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {
    // Silhouette for the default avatar (guests, or users without a photo)
    addIcons({ person });
    this.userService.ready.then(() => this.authReady.set(true));
  }

  goLogin() {
    this.router.navigate(['/login']);
  }

  goSignUp() {
    this.router.navigate(['/signup']);
  }

  goPersonalInfo() {
    this.router.navigate(['/personal-info']);
  }

  goNotifications() {
    this.router.navigate(['/notifications']);
  }

  goPlanner() {
    this.router.navigate(['/tabs/planner']);
  }

  goExplore() {
    this.router.navigate(['/tabs/explore']);
  }

  openAdventure(adv: UpcomingAdventure) {
    this.router.navigate(['/trail', adv.trailId]);
  }

  async showComingSoon(feature: string) {
    const toast = await this.toastCtrl.create({
      message: `${feature} is coming soon!`,
      duration: 1600,
      position: 'top',
      color: 'dark',
    });
    toast.present();
  }

  async confirmSignOut() {
    const alert = await this.alertCtrl.create({
      header: 'Sign Out',
      message: 'Are you sure you want to sign out of TrailTalk?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Sign Out',
          role: 'destructive',
          handler: async () => {
            await this.userService.signOut();
            this.router.navigate(['/login'], { replaceUrl: true });
          },
        },
      ],
    });
    alert.present();
  }
}
