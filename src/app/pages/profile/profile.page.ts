/**
 * Profile-page controller: connects the signed-in hiker?s profile, activity, and navigation actions to the profile template and app services.
 */
import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonIcon, IonButtons, IonButton,
  IonToggle, AlertController, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  documentAttachOutline, moonOutline, person, speedometerOutline, sunnyOutline,
} from 'ionicons/icons';
import { UserService } from '../../services/user.service';
import { NotificationService } from '../../services/notification.service';
import { ThemeService } from '../../services/theme.service';
import { CertificateService } from '../../services/certificate.service';
import { AdminAuthService } from '../admin/admin-auth.service';
import { AdminDataService } from '../admin/admin-data.service';
import { UpcomingAdventure } from '../../models/user.model';
import { WishlistService } from '../../services/wishlist.service';
import { TrailService } from '../../services/trail.service';
import { trailById } from '../explore/trail-lookup';

@Component({
  selector: 'app-profile',
  standalone: true,
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  imports: [
    CommonModule, IonContent, IonHeader, IonToolbar, IonTitle, IonIcon,
    IonButtons, IonButton, IonToggle,
  ],
})
export class ProfilePage {
  /**
   * False until Firebase has reported whether someone is signed in.
   * Prevents signed-in users from seeing the guest view flash on app start.
   *
   * Waits on the admin session too, so the Admin Panel row is either there on
   * first paint or not at all — it never pops in a moment later.
   */
  readonly authReady = signal(false);

  /** The signed-in user's profile, or null for guests. */
  readonly signedInProfile = computed(() =>
    this.userService.isAuthenticated() ? this.userService.profile() : null,
  );

  /**
   * Whether to show the Admin Panel row. There is no separate admin login —
   * admins sign in through the shared login like everyone else, so this row is
   * the only way into /admin without typing the URL.
   */
  readonly isAdmin = computed(() => this.adminAuth.isAdmin());

  /** "Owner" for a built-in account, "Admin" for a promoted hiker. */
  readonly adminLevel = computed(() => this.adminAuth.admin()?.level ?? '');

  constructor(
    public userService: UserService,
    public notificationService: NotificationService,
    public themeService: ThemeService,
    public certs: CertificateService,
    private adminAuth: AdminAuthService,
    private adminData: AdminDataService,
    private wishlist: WishlistService,
    private trailService: TrailService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {
    // Silhouette for the default avatar (guests, or users without a photo)
    addIcons({ person, moonOutline, sunnyOutline, documentAttachOutline, speedometerOutline });
    Promise.all([this.userService.ready, this.adminAuth.ready]).then(() =>
      this.authReady.set(true),
    );
  }

  /** Stores the set light mode selection so the related view and feature logic stay in sync. */
  setLightMode(enabled: boolean): void {
    this.themeService.setLightMode(enabled);
  }

  /** Navigates to sign-in so a guest can continue with an account-only action. */
  goLogin() {
    this.router.navigate(['/login']);
  }

  /** Navigates to registration for users who do not yet have an account. */
  goSignUp() {
    this.router.navigate(['/signup']);
  }

  /** Performs the go personal info operation for this feature and returns its result to the caller. */
  goPersonalInfo() {
    this.router.navigate(['/personal-info']);
  }

  /** Medical certificate upload. */
  goDocuments() {
    this.router.navigate(['/documents']);
  }

  /** Opens the notification screen associated with the current user. */
  goNotifications() {
    this.router.navigate(['/notifications']);
  }

  /** Performs the go planner operation for this feature and returns its result to the caller. */
  goPlanner() {
    this.router.navigate(['/tabs/planner']);
  }

  /** Performs the go explore operation for this feature and returns its result to the caller. */
  goExplore() {
    this.router.navigate(['/tabs/explore']);
  }

  /** The admin panel. Only reachable when isAdmin() is true. */
  goAdmin() {
    this.router.navigate(['/admin']);
  }

  /** Opens the open adventure interface for the user. */
  openAdventure(adv: UpcomingAdventure) {
    this.router.navigate(['/trail', adv.trailId]);
  }

  /** Un-hearts a wishlist trail without opening it. */
  removeFromWishlist(adv: UpcomingAdventure, ev: Event) {
    ev.stopPropagation();
    void this.wishlist.remove(adv.trailId, adv.name);
  }

  /** Region and difficulty from the trail itself; the saved duration if the trail is unknown. */
  wishSubtitle(adv: UpcomingAdventure): string {
    const t = trailById(adv.trailId) ?? this.trailService.getById(adv.trailId);
    if (!t) return adv.duration;
    return [t.region, t.difficulty].filter(Boolean).join(' · ');
  }

  /** The trail's current photo, falling back to the one saved with the heart. */
  wishImage(adv: UpcomingAdventure): string {
    return trailById(adv.trailId)?.image || adv.image;
  }

  /** Opens the show coming soon interface for the user. */
  async showComingSoon(feature: string) {
    const toast = await this.toastCtrl.create({
      message: `${feature} is coming soon!`,
      duration: 1600,
      position: 'top',
      color: 'dark',
    });
    toast.present();
  }

  /** Performs the confirm sign out operation for this feature and returns its result to the caller. */
  async confirmSignOut() {
    const alert = await this.alertCtrl.create({
      header: 'Sign Out',
      message: 'Are you sure you want to sign out of TrailBound?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Sign Out',
          role: 'destructive',
          handler: async () => {
            // Admin and hiker share one Firebase session, so signing out here
            // ends the admin session too. Drop the admin panel's live
            // listeners first: left subscribed against a signed-out session
            // they start throwing permission-denied. Safe to call when the
            // panel was never opened — it just clears empty state.
            this.adminData.stop();
            await this.userService.signOut();
            this.router.navigate(['/login'], { replaceUrl: true });
          },
        },
      ],
    });
    alert.present();
  }
}