/**
 * Wishlist service: the one place every heart button in the app goes through
 * (trail page, Home trail cards, Explore sheet), so they all behave the same
 * and the Profile tab's Wishlist updates the moment any of them is tapped.
 *
 * The list itself lives in UserService (users/{uid}.upcoming, entries marked
 * kind 'wishlist'). This only adds what every button needs on top: a sign-in
 * prompt for guests and a short confirmation toast.
 */
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/standalone';
import { UserService } from './user.service';

export interface WishlistTrail {
  id: string;
  name: string;
  image: string;
  duration: string;
}

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private readonly userService = inject(UserService);
  private readonly toastCtrl = inject(ToastController);
  private readonly router = inject(Router);

  /** Hearted trails, newest first. */
  readonly items = this.userService.wishlist;

  /** Whether this trail is hearted. Reactive when read inside a template. */
  has(trailId: string): boolean {
    return this.userService.wishlistIds().has(trailId);
  }

  /**
   * Hearts or un-hearts a trail. Guests get a toast with a Sign in button
   * instead of a heart that fills and then quietly fails to save.
   */
  async toggle(trail: WishlistTrail): Promise<void> {
    if (!this.userService.isAuthenticated()) {
      const returnUrl = this.router.url;
      await this.toast('Sign in to save trails to your wishlist', [
        {
          text: 'Sign in',
          handler: () => {
            this.router.navigate(['/login'], { queryParams: { returnUrl } });
          },
        },
      ]);
      return;
    }

    try {
      const on = await this.userService.toggleWishlist(trail);
      await this.toast(on ? `${trail.name} added to your wishlist` : `${trail.name} removed from your wishlist`);
    } catch (e) {
      console.warn('Could not update the wishlist.', e);
      await this.toast('Could not update your wishlist. Check your connection and try again.');
    }
  }

  /** Removes a trail by id, for lists that only hold the saved entry. */
  async remove(trailId: string, name: string): Promise<void> {
    if (!this.has(trailId)) return;
    await this.toggle({ id: trailId, name, image: '', duration: '' });
  }

  private async toast(message: string, buttons?: { text: string; handler: () => void }[]) {
    const t = await this.toastCtrl.create({
      message,
      duration: buttons ? 3200 : 1600,
      position: 'top',
      color: 'dark',
      buttons,
    });
    await t.present();
  }
}
