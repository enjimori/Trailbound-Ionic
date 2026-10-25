/**
 * Route guards for the admin area.
 *
 * These are UX, not security. They decide which screen you see; they do not
 * decide what data you can read. Anyone can open devtools, read the Firebase
 * project id out of the bundle, and call Firestore directly — firestore.rules
 * is what stops them. Keep both in step: if you loosen a rule, loosen the
 * guard, never the other way round.
 *
 * There is no admin login page. Admins sign in through the shared app login
 * at /login, same as everyone else; this guard is what sends them there and
 * what brings them back.
 */
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AdminAuthService } from './admin-auth.service';
import { adminAuth } from './admin-firebase';

/**
 * Lets an active admin through; sends everyone else to the shared login,
 * carrying the page they wanted so they land back on it.
 *
 * Returning a Promise is allowed for CanActivateFn, and awaiting `ready` is
 * the whole point: on a hard refresh of /admin, Firebase has not yet finished
 * restoring the session when the guard first runs, so a synchronous check
 * would log out an admin on every reload.
 */
export const adminGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AdminAuthService);
  const router = inject(Router);

  await auth.ready;

  // Someone who just signed in through the shared login can have a Firebase
  // session before onAuthStateChanged has finished reading their user
  // document. Ask directly rather than trusting a cached null, or the guard
  // bounces a real admin on the very hop after login.
  if (!auth.isAdmin() && adminAuth.currentUser) {
    await auth.refreshCurrentAdmin();
  }

  if (auth.isAdmin()) return true;

  // state.url is the full path they asked for, so /admin/bookings returns to
  // /admin/bookings rather than dumping them on the dashboard. login.page.ts
  // validates this value before using it, so it cannot be pointed off-site.
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};