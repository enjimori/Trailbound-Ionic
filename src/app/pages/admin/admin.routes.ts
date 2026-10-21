/**
 * Admin routes.
 *
 *   /admin/login        username + password
 *   /admin              dashboard
 *   /admin/bookings     every booking, change status, cancel
 *   /admin/hikers       every account, suspend, promote to admin
 *   /admin/trails       the 30 trails, open / close for booking
 *   /admin/community    posts and comments, remove
 *   /admin/reviews      trail reviews, remove
 *   /admin/certificates medical certificates + barangay clearances, approve / reject
 *   /admin/packages     packages, activities, guides, merchandise
 *   /admin/settings     admin account and password
 *
 * Everything below the shell is guarded by adminGuard. The shell holds the
 * sidebar and top bar; each page renders into its <router-outlet>.
 */
import type { Routes } from '@angular/router';
import { adminGuard, adminGuestGuard } from './admin.guard';

export const ADMIN_ROUTES: Routes = [
  {
    path: 'login',
    canActivate: [adminGuestGuard],
    loadComponent: () => import('./login/admin-login.page').then((m) => m.AdminLoginPage),
  },
  {
    path: '',
    canActivate: [adminGuard],
    loadComponent: () => import('./shell/admin-shell.component').then((m) => m.AdminShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./dashboard/admin-dashboard.page').then((m) => m.AdminDashboardPage),
      },
      {
        path: 'bookings',
        loadComponent: () =>
          import('./bookings/admin-bookings.page').then((m) => m.AdminBookingsPage),
      },
      {
        path: 'hikers',
        loadComponent: () => import('./hikers/admin-hikers.page').then((m) => m.AdminHikersPage),
      },
      {
        path: 'trails',
        loadComponent: () => import('./trails/admin-trails.page').then((m) => m.AdminTrailsPage),
      },
      {
        path: 'community',
        loadComponent: () =>
          import('./community/admin-community.page').then((m) => m.AdminCommunityPage),
      },
      {
        path: 'reviews',
        loadComponent: () =>
          import('./reviews/admin-reviews.page').then((m) => m.AdminReviewsPage),
      },
      {
        path: 'certificates',
        loadComponent: () =>
          import('./certificates/admin-certificates.page').then((m) => m.AdminCertificatesPage),
      },
      {
        path: 'packages',
        loadComponent: () =>
          import('./packages/admin-packages.page').then((m) => m.AdminPackagesPage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./settings/admin-settings.page').then((m) => m.AdminSettingsPage),
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
