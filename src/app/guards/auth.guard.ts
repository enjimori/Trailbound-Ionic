import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserService } from '../services/user.service';
import { AdminAuthService } from '../pages/admin/admin-auth.service';

/** Blocks protected routes unless the user is signed in. Waits for Firebase to restore the session first. */
export const authGuard: CanActivateFn = async () => {
  const user = inject(UserService);
  const router = inject(Router);
  await user.ready;
  await user.enforceSessionExpiry();
  return user.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

/** Keeps signed-in users away from /login and /signup. */
export const guestGuard: CanActivateFn = async () => {
  const user = inject(UserService);
  const admin = inject(AdminAuthService);
  const router = inject(Router);
  await user.ready;
  await user.enforceSessionExpiry();
  if (!user.isAuthenticated()) return true;
  await admin.ready;
  return router.createUrlTree([admin.isAdmin() ? '/admin' : '/tabs/home']);
};
