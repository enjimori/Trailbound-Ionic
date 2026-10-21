/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADMIN ACCOUNTS
 *
 * The admin panel signs in with a USERNAME and a password. Behind the scenes
 * a username is just a short name for a Firebase Authentication email, so the
 * password is checked by Firebase, never by code in this bundle.
 *
 *   Username  admin
 *   Password  TrailBound@2026      (first sign-in only — change it in
 *                                    Admin → Settings straight after)
 *
 * FIRST SIGN-IN
 * The admin login account does not exist in Firebase until somebody signs in
 * with the username and FIRST_SIGN_IN_PASSWORD below. That first sign-in
 * creates it. After that, the password is whatever Firebase holds, and the
 * value below no longer opens anything.
 *
 * ADDING ANOTHER ADMIN
 * Either promote a hiker from Admin → Hikers (they then sign in to the panel
 * with their own email and password), or add a row below AND add the same
 * email to the ADMIN_EMAILS list in firestore.rules.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface AdminAccount {
  username: string;
  email: string;
  name: string;
}

export const ADMIN_ACCOUNTS: AdminAccount[] = [
  {
    username: 'admin',
    email: 'admin@trailbound-ionic.firebaseapp.com',
    name: 'TrailBound Admin',
  },
];

/** Only used to create the built-in admin account the very first time. */
export const FIRST_SIGN_IN_PASSWORD = 'TrailBound@2026';

export function accountForUsername(username: string): AdminAccount | undefined {
  const u = username.trim().toLowerCase();
  return ADMIN_ACCOUNTS.find((a) => a.username === u || a.email === u);
}

export function isBuiltInAdminEmail(email: string | null | undefined): boolean {
  const e = (email ?? '').toLowerCase();
  return ADMIN_ACCOUNTS.some((a) => a.email === e);
}
