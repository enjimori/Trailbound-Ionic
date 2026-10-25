/**
 * Route guard for the permit office area.
 *
 * Like adminGuard, this is UX and not security. It decides which screen an
 * account sees; firestore.rules decides what it can read and write. The two
 * must stay in step — the rules let a permit_office account read lodged
 * applications and change nothing but the permit decision, and this guard
 * exists so such an account lands somewhere that reflects that.
 *
 * There is no separate office login. An officer signs in at the shared /login
 * like everyone else; this guard sends them there and brings them back.
 */
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { doc, getDoc } from 'firebase/firestore';
import { AdminAuthService } from '../admin-auth.service';
import { adminAuth, adminDb } from '../admin-firebase';

/**
 * Lets a permit officer — or an admin looking over their shoulder — through.
 *
 * The role is read straight from users/{uid} rather than through
 * AdminAuthService, which only knows the admin/not-admin question. One extra
 * document read on a route nobody opens often is a fair price for leaving the
 * admin identity model alone.
 *
 * Awaiting `ready` matters for the same reason it does in adminGuard: on a
 * hard refresh Firebase has not finished restoring the session when the guard
 * first runs, and a synchronous check would sign out a real officer on every
 * reload.
 */
export const officeGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AdminAuthService);
  const router = inject(Router);

  await auth.ready;

  const toLogin = () =>
    router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });

  const user = adminAuth.currentUser;
  if (!user) return toLogin();

  // An admin can open the office screens to see what an officer sees. Useful
  // for support, and for showing the flow without juggling two sign-ins.
  if (auth.isAdmin()) return true;

  try {
    const snap = await getDoc(doc(adminDb, 'users', user.uid));
    if (snap.data()?.['role'] === 'permit_office') return true;
  } catch {
    // A refused read means the rules have not been published yet, or this
    // account has no business here. Either way it is not a pass.
  }

  return toLogin();
};
