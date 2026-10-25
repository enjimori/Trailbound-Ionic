import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './guards/auth.guard';

/** App-level route table: connects URLs to lazy-loaded pages and access guards. */
export const routes: Routes = [
  // Public
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'signup',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/signup/signup.page').then((m) => m.SignupPage),
  },

  // Public: tabs (home, explore, community, bookings, profile).
  // Guests can browse everything here; the Profile tab shows a guest view
  // when nobody is signed in.
  {
    path: 'tabs',
    loadChildren: () => import('./tabs/tabs.routes').then((m) => m.tabsRoutes),
  },

  // Public: trail details, so guests can open trails from Explore / Home
  {
    path: 'trail/:id',
    loadComponent: () =>
      import('./pages/trail-detail/trail-detail.page').then((m) => m.TrailDetailPage),
  },

  // Protected: account pages opened from Profile (need a signed-in user)
  {
    path: 'personal-info',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/personal-info/personal-info.page').then((m) => m.PersonalInfoPage),
  },
  {
    path: 'documents',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/documents/documents.page').then((m) => m.DocumentsPage),
  },
  {
    path: 'notifications',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/notifications/notifications.page').then((m) => m.NotificationsPage),
  },

  // Protected: booking flow (Book Now on trail detail -> booking -> checkout -> confirmed).
  // Guests who tap Book Now are sent to the login page first.
  {
    path: 'booking/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/booking/booking.page').then((m) => m.BookingPage),
  },
  {
    path: 'checkout',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/checkout/checkout.page').then((m) => m.CheckoutPage),
  },
  {
    path: 'booking-confirmed/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/booking-confirmed/booking-confirmed.page').then((m) => m.BookingConfirmedPage),
  },

  // ── Admin ───────────────────────────────────────────────────────────────
  // Staff area, guarded by its own adminGuard (not authGuard — a signed-in
  // hiker is not an admin). Lazy-loaded, so none of this code ships to a
  // hiker who never opens /admin.
  //
  // MUST stay above the '**' route below. Angular matches top to bottom, so
  // a wildcard placed before this one would swallow /admin and redirect it
  // to the home tab.
  {
    path: 'admin',
    loadChildren: () => import('./pages/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },

  {
  path: 'office',
  loadChildren: () => import('./pages/admin/office/office.routes').then((m) => m.OFFICE_ROUTES),
},

{
  path: 'guide',
  loadChildren: () => import('./pages/admin/guide/guide.routes').then((m) => m.GUIDE_ROUTES),
},

  { path: '', redirectTo: 'tabs/home', pathMatch: 'full' },
  { path: '**', redirectTo: 'tabs/home' },
];
