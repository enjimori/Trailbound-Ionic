/**
 * Admin routes.
 *
 *   /admin/login        redirects to the shared app login
 *   /admin              dashboard
 *   /admin/bookings     every booking, move it through the permit workflow
 *   /admin/hikers       every account, suspend, promote to admin
 *   /admin/staff        grant and remove staff roles
 *   /admin/trails       manage trails and open / close for booking
 *   /admin/community    posts and comments, remove
 *   /admin/reviews      trail reviews, remove
 *   /admin/certificates medical certificates, approve / reject
 *   /admin/packages     packages, activities, guides, merchandise
 *   /admin/settings     admin account and password
 *
 * Everything below the shell is guarded by adminGuard. The shell holds the
 * sidebar and top bar; each page renders into its <router-outlet>.
 *
 * The permit office is NOT here. It lives at /office with its own guard and
 * its own small shell, because adminGuard protects this whole shell — hanging
 * a non-admin page off it would mean loosening one guard for nine admin pages
 * so that one account could reach a tenth.
 */
import type { Routes } from '@angular/router';
import { adminGuard } from './admin.guard';

export const ADMIN_ROUTES: Routes = [
  {
    path: 'login',
    redirectTo: '/login',
    pathMatch: 'full',
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
        path: 'staff',
        loadComponent: () => import('./staff/admin-staff.page').then((m) => m.AdminStaffPage),
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
