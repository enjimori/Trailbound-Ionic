/**
 * Admin sign-in — username and password.
 *
 * There is no "sign up" here on purpose. The built-in admin login is created
 * the first time someone signs in with the username and starting password in
 * admin.config.ts; more admins are promoted from Admin → Hikers.
 */
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, arrowForward, eyeOffOutline, eyeOutline, lockClosedOutline, personOutline,
} from 'ionicons/icons';
import { AdminAuthService } from '../admin-auth.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [ReactiveFormsModule, IonIcon],
  template: `
    <div class="al">
      <section class="al-art" aria-hidden="true">
        <div class="al-art-inner">
          <div class="al-brand">
            <img src="assets/logo/trailbound-badge.png" alt="" />
            <span>TrailBound<i>.</i></span>
          </div>
          <div class="al-copy">
            <p class="al-eyebrow">Admin panel</p>
            <h2>Every trail, booking and hiker in one place.</h2>
            <ul>
              <li>Track bookings and revenue as they come in</li>
              <li>Open or close trails for booking</li>
              <li>Keep the community feed and reviews clean</li>
            </ul>
          </div>
          <p class="al-credit">Mt. Ulap, Benguet</p>
        </div>
      </section>

      <section class="al-form-side">
        <div class="al-card">
          <div class="al-brand al-brand--mobile">
            <img src="assets/logo/trailbound-badge.png" alt="" />
            <span>TrailBound<i>.</i></span>
          </div>

          <h1>Welcome back</h1>
          <p class="al-sub">Sign in with your admin username and password.</p>

          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <label class="al-field" [class.bad]="touched('username')">
              <span>Username</span>
              <div class="al-input">
                <ion-icon name="person-outline"></ion-icon>
                <input
                  formControlName="username"
                  type="text"
                  autocomplete="username"
                  autocapitalize="off"
                  spellcheck="false"
                  placeholder="admin"
                />
              </div>
              @if (touched('username')) { <small>Enter your username.</small> }
            </label>

            <label class="al-field" [class.bad]="touched('password')">
              <span>Password</span>
              <div class="al-input">
                <ion-icon name="lock-closed-outline"></ion-icon>
                <input
                  formControlName="password"
                  [type]="showPw() ? 'text' : 'password'"
                  autocomplete="current-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  class="al-eye"
                  [attr.aria-label]="showPw() ? 'Hide password' : 'Show password'"
                  (click)="showPw.set(!showPw())"
                >
                  <ion-icon [name]="showPw() ? 'eye-off-outline' : 'eye-outline'"></ion-icon>
                </button>
              </div>
              @if (touched('password')) { <small>Enter your password.</small> }
            </label>

            @if (error()) {
              <p class="al-error" role="alert">
                <ion-icon name="alert-circle-outline"></ion-icon>{{ error() }}
              </p>
            }

            <button type="submit" class="al-submit" [disabled]="loading()">
              <span>{{ loading() ? 'Signing in…' : 'Sign in' }}</span>
              @if (!loading()) { <ion-icon name="arrow-forward"></ion-icon> }
            </button>
          </form>

          <p class="al-foot">
            Not an admin? <a href="/tabs/home">Go to the TrailBound app</a>
          </p>
        </div>
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .al { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); background: #fff; color: #1d2420; color-scheme: light; overflow-y: auto; font-family: 'Inter', system-ui, sans-serif; }
    .al * { box-sizing: border-box; font-family: inherit; }
    .al h1, .al h2 { font-family: inherit; margin: 0; letter-spacing: -0.02em; }

    .al-art { position: relative; margin: 14px; border-radius: 28px; overflow: hidden; background: #1d2420 url('/assets/trails/T003.jpg') center / cover no-repeat; min-height: 560px; }
    .al-art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(20,26,22,.55) 0%, rgba(20,26,22,.1) 38%, rgba(20,26,22,.82) 100%); }
    .al-art-inner { position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; padding: 34px 38px; color: #fff; }
    .al-brand { display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 700; }
    .al-brand img { width: 38px; height: 38px; border-radius: 50%; }
    .al-brand i { color: #dcb889; font-style: normal; }
    .al-brand--mobile { display: none; color: #1d2420; margin-bottom: 26px; }
    .al-copy { margin-top: auto; max-width: 440px; }
    .al-eyebrow { margin: 0 0 10px; font-size: 12px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: #dcb889; }
    .al-copy h2 { font-size: 34px; line-height: 1.15; font-weight: 700; color: #fff; }
    .al-copy ul { margin: 22px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
    .al-copy li { position: relative; padding-left: 22px; font-size: 14px; color: rgba(255,255,255,.86); }
    .al-copy li::before { content: ''; position: absolute; left: 0; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: #dcb889; }
    .al-credit { margin: 28px 0 0; font-size: 11.5px; color: rgba(255,255,255,.55); }

    .al-form-side { display: grid; place-items: center; padding: 40px 24px; }
    .al-card { width: 100%; max-width: 380px; }
    .al-card h1 { font-size: 30px; font-weight: 700; }
    .al-sub { margin: 8px 0 30px; color: #868b84; font-size: 14px; }
    form { display: grid; gap: 18px; }

    .al-field { display: grid; gap: 7px; }
    .al-field > span { font-size: 13px; font-weight: 600; color: #2b3530; }
    .al-field small { color: #dc4f4b; font-size: 12px; }
    .al-input { display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 16px; border: 1px solid #e3e3dd; border-radius: 14px; background: #fafaf7; transition: border-color .15s, background .15s, box-shadow .15s; }
    .al-input:focus-within { border-color: #1d2420; background: #fff; box-shadow: 0 0 0 4px rgba(29,36,32,.06); }
    .al-field.bad .al-input { border-color: #e9a3a1; }
    .al-input > ion-icon { font-size: 18px; color: #9a9e97; flex: none; }
    .al-input input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; font-size: 15px; color: #1d2420; }
    .al-input input::placeholder { color: #b8bbb5; }
    .al-eye { border: 0; background: none; padding: 6px; margin-right: -6px; display: grid; place-items: center; cursor: pointer; color: #868b84; font-size: 19px; }

    .al-error { margin: 0; display: flex; gap: 9px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; background: #fbe9e8; color: #b23a36; font-size: 13px; line-height: 1.45; }
    .al-error ion-icon { font-size: 18px; flex: none; }

    .al-submit { margin-top: 6px; height: 54px; border: 0; border-radius: 999px; background: #1d2420; color: #fff; font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer; transition: background .15s, transform .1s; }
    .al-submit:hover { background: #2f3a34; }
    .al-submit:active { transform: scale(.99); }
    .al-submit:disabled { opacity: .6; cursor: default; }
    .al-submit ion-icon { font-size: 18px; color: #dcb889; }

    .al-foot { margin: 26px 0 0; text-align: center; font-size: 13px; color: #868b84; }
    .al-foot a { color: #1d2420; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: #dcb889; }

    @media (max-width: 860px) {
      .al { grid-template-columns: 1fr; }
      .al-art { display: none; }
      .al-brand--mobile { display: flex; }
      .al-form-side { place-items: start center; padding-top: 56px; }
    }
  `],
})
export class AdminLoginPage {
  private fb = inject(FormBuilder);
  private auth = inject(AdminAuthService);
  private router = inject(Router);

  form = this.fb.nonNullable.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  readonly loading = signal(false);
  readonly showPw = signal(false);
  readonly error = signal('');

  constructor() {
    addIcons({ alertCircleOutline, arrowForward, eyeOffOutline, eyeOutline, lockClosedOutline, personOutline });
    this.form.valueChanges.subscribe(() => this.error.set(''));
  }

  touched(name: 'username' | 'password'): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  async submit(): Promise<void> {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    try {
      const { username, password } = this.form.getRawValue();
      await this.auth.signIn(username, password);
      this.router.navigateByUrl('/admin', { replaceUrl: true });
    } catch (e: unknown) {
      this.error.set((e as Error)?.message ?? 'Could not sign in. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
