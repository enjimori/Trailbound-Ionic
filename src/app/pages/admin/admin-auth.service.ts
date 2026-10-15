/**
 * Admin session — sign in, remember who is signed in, confirm they are an admin.
 *
 * ── WHY THIS DOES NOT CALL UserService.signIn() ───────────────────────────
 * Your hiker login calls `UserService.signIn(email, password)`. This service
 * calls `signInWithEmailAndPassword` instead. That is not a second set of
 * credentials: UserService is a wrapper around this same Firebase Auth call,
 * so there is one account store, one password, one source of truth. The only
 * difference is whose in-memory state updates afterwards.
 *
 * Keeping admin separate is deliberate:
 *   - Signing in here does not populate the hiker app's profile state, so the
 *     admin panel can never half-log-you-into the tabs UI.
 *   - The admin panel stays importable without pulling the hiker UserService
 *     (and whatever it imports) into the admin bundle.
 *
 * If you would rather route through UserService, there is exactly one line to
 * change — it is marked SWAP POINT below. Everything else stays as is.
 *
 * ── WHAT MAKES SOMEONE AN ADMIN ───────────────────────────────────────────
 * Their own Firestore document at users/{uid} says role: 'admin' and
 * status: 'active'. This class checks that so the UI can react, but the check
 * that matters is the identical one in firestore.rules. A guard in the
 * browser is a courtesy; rules are the lock.
 */
import { Injectable, computed, signal } from '@angular/core';
import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { firebaseAuth, db, isFirebaseConfigured } from '../../services/firebase';

/** The slice of the user document the admin shell actually displays. */
export interface AdminIdentity {
  uid: string;
  email: string;
  name: string;
  role: string;
  status: string;
}

@Injectable({ providedIn: 'root' })
export class AdminAuthService {
  /** The signed-in admin, or null. */
  private readonly _admin = signal<AdminIdentity | null>(null);
  readonly admin = this._admin.asReadonly();

  /**
   * True while Firebase is restoring a session from the previous page load.
   * The guard waits on `ready` rather than reading this, but the login page
   * uses it to avoid flashing the form at someone who is already signed in.
   */
  private readonly _checking = signal(true);
  readonly checking = this._checking.asReadonly();

  readonly isAdmin = computed(() => this._admin() !== null);

  /**
   * Resolves once Firebase has reported the initial auth state — signed in or
   * not. Without this, a guard that runs on a hard refresh of /admin sees
   * "nobody signed in" (Firebase has not finished reading its local session
   * yet) and bounces a legitimate admin to the login page.
   */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      if (!isFirebaseConfigured()) {
        this._checking.set(false);
        resolve();
        return;
      }

      onAuthStateChanged(firebaseAuth, async (user: User | null) => {
        if (!user) {
          this._admin.set(null);
        } else {
          // Re-read the role on every auth change. A revoked admin should
          // lose access on their next page load, not keep a stale session.
          this._admin.set(await this.loadIdentity(user));
        }
        this._checking.set(false);
        resolve(); // resolve() after the first call; later calls are no-ops.
      });
    });
  }

  /**
   * Signs in and verifies the account is an active admin. A non-admin who
   * types correct hiker credentials here is signed straight back out, so the
   * app is never left holding a session the admin UI will not honour.
   *
   * Throws an Error whose message is safe to show on screen.
   */
  async signIn(email: string, password: string): Promise<AdminIdentity> {
    if (!isFirebaseConfigured()) {
      throw new Error(
        'Firebase is not configured yet. Paste your config into src/app/services/firebase.ts.',
      );
    }

    let user: User;
    try {
      // ── SWAP POINT ──────────────────────────────────────────────────────
      // To route through your existing service instead, inject UserService
      // and replace these two lines with:
      //     await this.userService.signIn(email, password);
      //     user = firebaseAuth.currentUser!;
      const cred = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      user = cred.user;
    } catch (err: unknown) {
      throw new Error(describeAuthError(err));
    }

    const identity = await this.loadIdentity(user);

    if (!identity) {
      // Signed in successfully, but not an admin. Drop the session rather
      // than leaving them authenticated against a UI that will refuse them.
      await fbSignOut(firebaseAuth);
      this._admin.set(null);
      throw new Error('This account does not have admin access.');
    }

    this._admin.set(identity);
    return identity;
  }

  async signOut(): Promise<void> {
    await fbSignOut(firebaseAuth);
    this._admin.set(null);
  }

  /**
   * Reads users/{uid} and returns an identity only if it is an active admin.
   * Returns null for a hiker, a suspended admin, or a missing document.
   */
  private async loadIdentity(user: User): Promise<AdminIdentity | null> {
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (!snap.exists()) return null;

      const data = snap.data() as Record<string, unknown>;
      const role = String(data['role'] ?? '');
      const status = String(data['status'] ?? '');
      if (role !== 'admin' || status !== 'active') return null;

      return {
        uid: user.uid,
        email: user.email ?? String(data['email'] ?? ''),
        name: String(data['name'] ?? 'Admin'),
        role,
        status,
      };
    } catch {
      // A permission-denied here almost always means firestore.rules is
      // deployed but this user has no admin document. Treat it as "not an
      // admin" rather than crashing the guard.
      return null;
    }
  }
}

/**
 * Firebase auth error codes are not written for end users
 * ("auth/invalid-credential"). These are.
 */
function describeAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Wrong email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'auth/network-request-failed':
      return 'Could not reach Firebase. Check your connection.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled in the Firebase console.';
    case 'auth/configuration-not-found':
      return 'Firebase Authentication is not set up for this project yet.';
    default:
      return (err as { message?: string })?.message ?? 'Could not sign in. Please try again.';
  }
}
