/**
 * Login-page controller: validates the sign-in form, calls the authentication service, and routes the user after successful sign-in.
 */
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonCheckbox, IonContent, IonIcon, IonInput, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { eyeOffOutline, eyeOutline } from 'ionicons/icons';
import { doc, getDoc } from 'firebase/firestore';
import { UserService } from '../../services/user.service';
import { AdminAuthService } from '../admin/admin-auth.service';
import { ADMIN_ACCOUNTS } from '../admin/admin.config';
// Aliased because this component already has an `adminAuth` field holding the
// service; this is the Firebase auth object the service is built on.
import { adminAuth as firebaseAuth, adminDb } from '../admin/admin-firebase';
import { emailValidator, fieldError } from '../../validators/form.validators';

/** Who is signing in, as far as where to send them is concerned. */
type SignedInAs = 'admin' | 'permit_office' | 'guide' | 'hiker';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [CommonModule, ReactiveFormsModule, IonCheckbox, IonContent, IonIcon, IonInput],
})
export class LoginPage {
  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private adminAuth = inject(AdminAuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toastCtrl = inject(ToastController);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, emailValidator()]],
    password: ['', [Validators.required]],
    remember: [false],
  });

  loading = false;
  showPassword = false;
  /** Result of the account check (wrong password, unknown account, etc.). */
  loginError = '';

  constructor() {
    addIcons({ eyeOutline, eyeOffOutline });
    this.form.valueChanges.subscribe(() => (this.loginError = ''));
  }

  /** Performs the err operation for this feature and returns its result to the caller. */
  err(name: 'email' | 'password') {
    return fieldError(this.form.get(name), name === 'email' ? 'Email' : 'Password');
  }

  /** Submits the sign-in request and updates the page according to the authentication result. */
  async signIn() {
    if (this.loading) return;

    // 0) Built-in admin accounts are documented by username ("admin"), but the
    //    email field rejects a bare word before Firebase is ever contacted —
    //    which looks like a failed login when nothing was attempted. Expand a
    //    known admin username to its full address first, so the username in
    //    the README actually works. Only an exact match to an entry in
    //    admin.config.ts is expanded; a hiker who mistypes their email still
    //    gets the normal validation message.
    this.expandAdminUsername();

    // 1) Syntax check
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    // 2) Account check against Firebase
    this.loading = true;
    try {
      const { email, password, remember } = this.form.getRawValue();
      await this.userService.signIn(email, password, remember);

      // 3) Settle who this is before leaving the page.
      //
      // There is no separate admin or office login — everyone comes through
      // this form. The route guards read the account's role, and they run the
      // moment we navigate; onAuthStateChanged has not necessarily finished by
      // then, so a guard could read null and bounce a real admin straight back
      // here. Resolving the role now closes that race.
      const who = await this.signedInAs();

      const toast = await this.toastCtrl.create({
        message: 'Welcome back!',
        duration: 1400,
        position: 'top',
        color: 'success',
      });
      toast.present();
      this.router.navigateByUrl(this.destination(who), { replaceUrl: true });
    } catch (e: any) {
      this.loginError = e?.message ?? 'Could not sign in. Please try again.';
    } finally {
      this.loading = false;
    }
  }

  /**
   * Turns "admin" into "admin@trailbound-ionic.firebaseapp.com".
   *
   * Matches the local part of each entry in ADMIN_ACCOUNTS, so adding another
   * built-in account there makes its username work here with no change.
   * Anything containing "@" is left exactly as typed.
   */
  private expandAdminUsername(): void {
    const typed = this.form.controls.email.value.trim().toLowerCase();
    if (!typed || typed.includes('@')) return;

    const match = ADMIN_ACCOUNTS.find((a) => a.email.split('@')[0] === typed);
    if (match) this.form.controls.email.setValue(match.email);
  }

  /**
   * Which kind of account just signed in.
   *
   * Admin is asked first through AdminAuthService, which also covers the
   * built-in accounts in admin.config.ts that have no users document at all.
   * Only if that comes back empty do we read users/{uid} for a staff role —
   * one small document read on a hiker's sign-in, which is a fair price for
   * landing an officer on their own screen instead of the trail feed.
   *
   * A refused or failed read means hiker. Guards and firestore.rules decide
   * what an account may actually do; this only decides where it lands, so
   * failing to the least-privileged answer costs nothing but a redirect.
   */
  private async signedInAs(): Promise<SignedInAs> {
    if (await this.adminAuth.refreshCurrentAdmin()) return 'admin';

    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return 'hiker';

    try {
      const role = (await getDoc(doc(adminDb, 'users', uid))).data()?.['role'];
      if (role === 'permit_office' || role === 'guide') return role;
    } catch {
      // Offline, or the rules refused the read. Treat as an ordinary hiker.
    }
    return 'hiker';
  }

  /** Navigates to registration for users who do not yet have an account. */
  goSignUp() {
    this.router.navigate(['/signup']);
  }

  /**
   * Where to go after signing in.
   *
   * A returnUrl wins where the account can actually go there. The guards send
   * ?returnUrl=/admin/bookings so an admin lands on the page they asked for
   * rather than the dashboard, and a hiker asked to sign in mid-task (liking a
   * post, booking a trail) goes back to that task. Admins and officers are
   * hikers too — with their own bookings and saved trails — so overriding
   * their returnUrl with a panel would break those flows.
   *
   * The exception is a returnUrl into an area this account cannot enter. An
   * officer who opened /admin gets bounced here with ?returnUrl=/admin; honour
   * it and the guard bounces them back, forever. Dropping it and using the
   * role's own home breaks the loop, and the guards still decide access.
   */
  private destination(who: SignedInAs): string {
    const asked = this.returnUrl();
    if (asked && this.canEnter(asked, who)) return asked;

    switch (who) {
      case 'admin': return '/admin';
      case 'permit_office': return '/office';
      case 'guide': return '/guide';
      default: return '/tabs/home';
    }
  }

  /**
   * Whether this account would survive the guard on that path.
   *
   * Deliberately generous: anything outside /admin and /office is the hiker
   * app, which every signed-in account can use. This is loop prevention, not
   * access control — firestore.rules is what actually refuses.
   */
  private canEnter(url: string, who: SignedInAs): boolean {
    if (url.startsWith('/admin')) return who === 'admin';
    if (url.startsWith('/office')) return who === 'admin' || who === 'permit_office';
    if (url.startsWith('/guide')) return who === 'admin' || who === 'guide';
    return true;
  }

  /**
   * The requested returnUrl if it is a safe in-app path, otherwise ''.
   * Rejects protocol-relative (//evil.com), absolute (https://evil.com) and
   * backslash-escaped URLs so this can never navigate off the app.
   */
  private returnUrl(): string {
    const url = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
    const safe =
      url.startsWith('/') && !url.startsWith('//') && !url.includes('://') && !url.includes('\\');
    return safe ? url : '';
  }

  /** Browse the app without an account. */
  continueAsGuest() {
    // Never a staff area: a guest has no session, so the guard would bounce
    // them straight back to this page.
    this.router.navigateByUrl(this.destination('hiker'), { replaceUrl: true });
  }
}