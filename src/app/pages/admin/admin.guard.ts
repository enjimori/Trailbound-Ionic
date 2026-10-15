/**
 * Route guards for the admin area.
 *
 * These are UX, not security. They decide which screen you see; they do not
 * decide what data you can read. Anyone can open devtools, read the Firebase
 * project id out of the bundle, and call Firestore directly — firestore.rules
 * is what stops them. Keep both in step: if you loosen a rule, loosen the
 * guard, never the other way round.
 */
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AdminAuthService } from './admin-auth.service';

/**
 * Lets an active admin through; sends everyone else to the admin login.
 *
 * Returning a Promise is allowed for CanActivateFn, and awaiting `ready` is
 * the whole point: on a hard refresh of /admin, Firebase has not yet finished
 * restoring the session when the guard first runs, so a synchronous check
 * would log out an admin on every reload.
 */
export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AdminAuthService);
  const router = inject(Router);

  await auth.ready;

  if (auth.isAdmin()) return true;
  return router.createUrlTree(['/admin/login']);
};

/**
 * The reverse, for the login page itself: an admin who is already signed in
 * should land on the admin home rather than being shown the form again.
 */
export const adminGuestGuard: CanActivateFn = async () => {
  const auth = inject(AdminAuthService);
  const router = inject(Router);

  await auth.ready;

  if (auth.isAdmin()) return router.createUrlTree(['/admin']);
  return true;
};
