import { Injectable, signal, computed } from '@angular/core';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  deleteUser,
  User,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase.client';
import { UserProfile, UpcomingAdventure } from '../models/user.model';

/** Error with a Firebase code and a user-friendly message. */
export class AuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface SignUpData {
  name: string;
  email: string;
  phone: string;
  dob: string;
  gender: string;
  password: string;
}

const EMPTY_PROFILE: UserProfile = {
  name: '',
  location: '',
  bio: '',
  avatar: '',
  totalHikes: 0,
  totalDistanceKm: 0,
  highestPeakM: 0,
  email: '',
  phone: '',
  dob: '',
  gender: '' as unknown as UserProfile['gender'],
  emergencyContactName: '',
  emergencyContactPhone: '',
};

/**
 * Older accounts were given a random stock photo (pravatar) at sign-up.
 * That's not a picture the user chose, so treat it as "no avatar".
 */
function isPlaceholderAvatar(url: string | undefined | null): boolean {
  return !!url && url.startsWith('https://i.pravatar.cc/');
}

function friendlyAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/email-already-in-use':
      return 'This email is already registered. Try logging in instead.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 8 characters with a letter and a number.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly _profile = signal<UserProfile>({ ...EMPTY_PROFILE });
  readonly profile = computed(() => this._profile());

  private readonly _upcoming = signal<UpcomingAdventure[]>([]);
  readonly upcoming = computed(() => this._upcoming());

  private readonly _isAuthenticated = signal<boolean>(false);
  readonly isAuthenticated = this._isAuthenticated.asReadonly();

  /** Resolves once Firebase has reported the initial auth state (and the profile is loaded). */
  readonly ready: Promise<void>;

  /** While true, signIn/signUp handle state themselves and the listener stays out of the way. */
  private manualAuth = false;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      onAuthStateChanged(auth, async (user) => {
        if (this.manualAuth) {
          resolve();
          return;
        }
        if (user) {
          await this.loadProfile(user);
          this._isAuthenticated.set(true);
        } else {
          this.resetState();
        }
        resolve();
      });
    });
  }

  // ---------- Auth ----------

  async signUp(data: SignUpData): Promise<void> {
    this.manualAuth = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, data.email.trim(), data.password);
      const profile: UserProfile = {
        ...EMPTY_PROFILE,
        name: data.name.trim(),
        email: cred.user.email ?? data.email.trim(),
        phone: data.phone.trim(),
        dob: data.dob,
        gender: data.gender as UserProfile['gender'],
        // avatar stays '' until the user uploads one; the app shows a default silhouette
      };
      try {
        await setDoc(doc(db, 'users', cred.user.uid), { profile, upcoming: [] });
      } catch (e) {
        // Don't leave an auth account without a profile document.
        await deleteUser(cred.user).catch(() => {});
        throw e;
      }
      this._profile.set(profile);
      this._upcoming.set([]);
      this._isAuthenticated.set(true);
    } catch (e: any) {
      throw new AuthError(e?.code ?? 'unknown', friendlyAuthError(e?.code ?? ''));
    } finally {
      this.manualAuth = false;
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    this.manualAuth = true;
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await this.loadProfile(cred.user);
      this._isAuthenticated.set(true);
    } catch (e: any) {
      throw new AuthError(e?.code ?? 'unknown', friendlyAuthError(e?.code ?? ''));
    } finally {
      this.manualAuth = false;
    }
  }

  async signOut(): Promise<void> {
    await fbSignOut(auth);
    this.resetState();
  }

  // ---------- Profile data ----------

  async updateProfile(partial: Partial<UserProfile>): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not signed in.');
    const merged: UserProfile = { ...this._profile(), ...partial };
    await setDoc(doc(db, 'users', uid), { profile: merged }, { merge: true });
    this._profile.set(merged);
  }

  updateAvatar(dataUrl: string) {
    return this.updateProfile({ avatar: dataUrl });
  }

  async addUpcoming(adv: UpcomingAdventure) {
    await this.saveUpcoming([adv, ...this._upcoming()]);
  }

  async removeUpcoming(id: string) {
    await this.saveUpcoming(this._upcoming().filter((a) => a.id !== id));
  }

  // ---------- Internals ----------

  private async saveUpcoming(list: UpcomingAdventure[]) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not signed in.');
    await setDoc(doc(db, 'users', uid), { upcoming: list }, { merge: true });
    this._upcoming.set(list);
  }

  private async loadProfile(user: User): Promise<void> {
    const fallback: UserProfile = {
      ...EMPTY_PROFILE,
      email: user.email ?? '',
    };
    try {
      const ref = doc(db, 'users', user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        const loaded: UserProfile = { ...fallback, ...(data['profile'] ?? {}), email: user.email ?? '' };
        if (isPlaceholderAvatar(loaded.avatar)) loaded.avatar = '';
        this._profile.set(loaded);
        this._upcoming.set(data['upcoming'] ?? []);
      } else {
        await setDoc(ref, { profile: fallback, upcoming: [] });
        this._profile.set(fallback);
        this._upcoming.set([]);
      }
    } catch (e) {
      console.error('Could not load profile from Firestore', e);
      this._profile.set(fallback);
      this._upcoming.set([]);
    }
  }

  private resetState() {
    this._profile.set({ ...EMPTY_PROFILE });
    this._upcoming.set([]);
    this._isAuthenticated.set(false);
  }
}
