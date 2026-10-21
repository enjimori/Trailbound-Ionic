/**
 * Admin session — sign in with a username and password, remember who is
 * signed in, and confirm they really are an admin.
 *
 * WHO COUNTS AS AN ADMIN
 *   1. The built-in accounts in admin.config.ts (username "admin").
 *   2. Any hiker an admin has promoted from Admin → Hikers, which sets
 *      role: 'admin' on their users/{uid} document. They sign in here with
 *      their own email and password.
 *
 * This class checks both so the screens can react, but the check that
 * actually protects the data is the identical one in firestore.rules. A route
 * guard in the browser is a courtesy; the rules are the lock.
 */
import { Injectable, computed, signal } from '@angular/core';
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updatePassword,
  updateProfile,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { adminAuth, adminDb } from './admin-firebase';
import {
  FIRST_SIGN_IN_PASSWORD,
  accountForUsername,
  isBuiltInAdminEmail,
  ADMIN_ACCOUNTS,
} from './admin.config';

export interface AdminIdentity {
  uid: string;
  email: string;
  /** What the panel shows in the corner. */
  name: string;
  /** The short sign-in name, or the email for a promoted hiker. */
  username: string;
  /** Built-in accounts are "Owner"; promoted hikers are "Admin". */
  level: 'Owner' | 'Admin';
}

@Injectable({ providedIn: 'root' })
export class AdminAuthService {
  private readonly _admin = signal<AdminIdentity | null>(null);
  readonly admin = this._admin.asReadonly();
  readonly isAdmin = computed(() => this._admin() !== null);

  /**
   * Resolves once Firebase has restored (or not) the previous session.
   * Without waiting for this, a hard refresh of /admin would see "nobody
   * signed in" for a split second and bounce a real admin to the login page.
   */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      onAuthStateChanged(adminAuth, async (user: User | null) => {
        // Re-check on every change, so a demoted admin loses access on their
        // next page load rather than keeping a stale session.
        this._admin.set(user ? await this.loadIdentity(user) : null);
        resolve();
      });
    });
  }

  /** Throws an Error whose message is safe to show on screen. */
  async signIn(username: string, password: string): Promise<AdminIdentity> {
    const input = username.trim();
    const account = accountForUsername(input);
    const email = account?.email ?? (input.includes('@') ? input.toLowerCase() : null);

    if (!email) {
      throw new Error('Unknown username. Use your admin username or admin email address.');
    }

    let cred: UserCredential;
    try {
      cred = await signInWithEmailAndPassword(adminAuth, email, password);
    } catch (err) {
      const code = codeOf(err);
      const accountMayNotExistYet =
        code === 'auth/invalid-credential' ||
        code === 'auth/invalid-login-credentials' ||
        code === 'auth/user-not-found';

      // First ever sign-in with a built-in username: create its login.
      if (account && accountMayNotExistYet && password === FIRST_SIGN_IN_PASSWORD) {
        cred = await this.createBuiltInAccount(account.email, account.name, password);
      } else {
        throw new Error(describeAuthError(err));
      }
    }

    const identity = await this.loadIdentity(cred.user);
    if (!identity) {
      // Correct hiker credentials, but not an admin. Drop the session so the
      // panel is never left holding a login it will not honour.
      await fbSignOut(adminAuth);
      this._admin.set(null);
      throw new Error('This account does not have admin access.');
    }

    this._admin.set(identity);
    return identity;
  }

  async signOut(): Promise<void> {
    await fbSignOut(adminAuth);
    this._admin.set(null);
  }

  /** Re-checks the current password, then sets the new one. */
  async changePassword(current: string, next: string): Promise<void> {
    const user = adminAuth.currentUser;
    if (!user || !user.email) throw new Error('You are not signed in.');
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
    } catch (err) {
      const code = codeOf(err);
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/invalid-login-credentials') {
        throw new Error('Your current password is not correct.');
      }
      throw new Error(describeAuthError(err));
    }
    try {
      await updatePassword(user, next);
    } catch (err) {
      throw new Error(describeAuthError(err));
    }
  }

  private async createBuiltInAccount(email: string, name: string, password: string): Promise<UserCredential> {
    try {
      const cred = await createUserWithEmailAndPassword(adminAuth, email, password);
      await updateProfile(cred.user, { displayName: name }).catch(() => {});
      return cred;
    } catch (err) {
      // The login already exists, so the password typed was simply wrong.
      if (codeOf(err) === 'auth/email-already-in-use') {
        throw new Error('Wrong username or password.');
      }
      throw new Error(describeAuthError(err));
    }
  }

  /** Returns an identity only for an active admin; null for anyone else. */
  private async loadIdentity(user: User): Promise<AdminIdentity | null> {
    const email = (user.email ?? '').toLowerCase();

    if (isBuiltInAdminEmail(email)) {
      const account = ADMIN_ACCOUNTS.find((a) => a.email === email)!;
      return {
        uid: user.uid,
        email,
        name: user.displayName || account.name,
        username: account.username,
        level: 'Owner',
      };
    }

    try {
      const snap = await getDoc(doc(adminDb, 'users', user.uid));
      if (!snap.exists()) return null;
      const data = snap.data() as Record<string, any>;
      if (data['role'] !== 'admin' || data['status'] === 'suspended') return null;
      const name = String(data['profile']?.name || data['name'] || user.displayName || 'Admin');
      return { uid: user.uid, email, name, username: email, level: 'Admin' };
    } catch {
      // permission-denied here means the rules do not see this user as an
      // admin either. Treat it as "not an admin" rather than crashing.
      return null;
    }
  }
}

function codeOf(err: unknown): string {
  return (err as { code?: string })?.code ?? '';
}

/** Firebase error codes, rewritten for people. */
function describeAuthError(err: unknown): string {
  switch (codeOf(err)) {
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Wrong username or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'auth/network-request-failed':
      return 'Could not reach Firebase. Check your internet connection.';
    case 'auth/weak-password':
      return 'Use at least 6 characters for the new password.';
    case 'auth/requires-recent-login':
      return 'Please sign out, sign back in, then try again.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is turned off in the Firebase console.';
    default:
      return (err as { message?: string })?.message ?? 'Could not sign in. Please try again.';
  }
}
