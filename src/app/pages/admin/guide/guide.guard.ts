/**
 * Route guard for the guide area.
 *
 * Like adminGuard and officeGuard, this is UX and not security. It decides
 * which screen an account sees; firestore.rules decides what it can read and
 * write. A guide may read bookings whose guideId matches their own roster id,
 * and may change nothing but the status of a confirmed hike to completed or
 * no_show. Keep the two in step.
 *
 * There is no separate guide login. A guide signs in at the shared /login like
 * everyone else; this guard sends them there and brings them back.
 */
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { doc, getDoc } from 'firebase/firestore';
import { AdminAuthService } from '../admin-auth.service';
import { adminAuth, adminDb } from '../admin-firebase';

/**
 * Lets a guide — or an admin looking over their shoulder — through.
 *
 * Note this checks the ROLE, not the roster link. An account with the guide
 * role but no guideRosterId gets in and is told plainly that it has not been
 * linked yet. Bouncing it to the login page instead would look like a broken
 * password, and the person has no way to tell the difference.
 */
export const guideGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AdminAuthService);
  const router = inject(Router);

  await auth.ready;

  const toLogin = () =>
    router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });

  const user = adminAuth.currentUser;
  if (!user) return toLogin();

  if (auth.isAdmin()) return true;

  try {
    if ((await getDoc(doc(adminDb, 'users', user.uid))).data()?.['role'] === 'guide') return true;
  } catch {
    // A refused read means the rules have not been published, or this account
    // has no business here. Either way it is not a pass.
  }

  return toLogin();
};
