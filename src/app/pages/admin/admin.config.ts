/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADMIN ACCOUNTS
 *
 * Built-in owner accounts are allowlisted by Firestore rules and sign in
 * through the same email-and-password form as other app users.
 *
 * ADDING ANOTHER ADMIN
 * Either promote a hiker from Admin → Hikers (they then sign in to the panel
 * with their existing email and password), or add a row below AND add the same
 * email to the ADMIN_EMAILS list in firestore.rules.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface AdminAccount {
  email: string;
  name: string;
}

export const ADMIN_ACCOUNTS: AdminAccount[] = [
  {
    email: 'trailbound.philippines@gmail.com',
    name: 'TrailBound Admin',
  },
];

export function isBuiltInAdminEmail(email: string | null | undefined): boolean {
  const e = (email ?? '').toLowerCase();
  return ADMIN_ACCOUNTS.some((a) => a.email === e);
}
