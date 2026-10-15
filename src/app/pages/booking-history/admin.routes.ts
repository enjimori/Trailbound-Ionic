/**
 * Admin routes — login only, for now.
 *
 * Deliberately small. Once you confirm sign-in works end to end, modules get
 * added as children of the guarded route below (dashboard, users, bookings,
 * and so on), one at a time.
 */
import type { Routes } from '@angular/router';
import { adminGuard, adminGuestGuard } from './admin.guard';

export const ADMIN_ROUTES: Routes = [
  {
    path: 'login',
    canActivate: [adminGuestGuard],
    loadComponent: () =>
      import('./login/admin-login.page').then((m) => m.AdminLoginPage),
  },
  {
    path: '',
    canActivate: [adminGuard],
    loadComponent: () => import('./home/admin-home.page').then((m) => m.AdminHomePage),
  },
];
