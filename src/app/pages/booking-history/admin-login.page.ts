/**
 * Admin sign-in.
 *
 * Styled with the same --app-* tokens as the hiker login so it reads as the
 * same product, but plainer: no hero photo, no "continue as guest", no
 * sign-up link. There is no such thing as self-service admin registration —
 * the first admin is created by hand in the Firebase console, and after that
 * admins are promoted from the Users module.
 *
 * Every token below carries a fallback, so this page still looks right if it
 * is ever opened before the shared theme stylesheet has loaded.
 */
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonIcon, IonInput } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { eyeOutline, eyeOffOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { AdminAuthService } from '../admin-auth.service';

@Component({
  selector: 'app-admin-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonContent, IonIcon, IonInput],
  template: `
    <ion-content [fullscreen]="true" class="admin-login-content">
      <div class="wrap">
        <div class="card">
          <div class="mark">
            <ion-icon name="shield-checkmark-outline"></ion-icon>
          </div>

          <h1>TrailBound Admin</h1>
          <p class="sub">Staff access only</p>

          <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div class="field">
              <label for="admin-email">Email</label>
              <ion-input
                inputId="admin-email"
                formControlName="email"
                type="email"
                inputmode="email"
                autocomplete="email"
                placeholder="you@trailbound.ph"
                class="ad-input"
                fill="outline"
              ></ion-input>
              <p class="err" *ngIf="touched('email')">Enter a valid email address.</p>
            </div>

            <div class="field">
              <label for="admin-password">Password</label>
              <ion-input
                inputId="admin-password"
                formControlName="password"
                [type]="showPw() ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="••••••••"
                class="ad-input"
                fill="outline"
              >
                <ion-icon
                  slot="end"
                  class="eye"
                  [name]="showPw() ? 'eye-off-outline' : 'eye-outline'"
                  [attr.aria-label]="showPw() ? 'Hide password' : 'Show password'"
                  role="button"
                  tabindex="0"
                  (click)="showPw.set(!showPw())"
                  (keydown.enter)="showPw.set(!showPw())"
                ></ion-icon>
              </ion-input>
              <p class="err" *ngIf="touched('password')">Password is required.</p>
            </div>

            <p class="form-err" *ngIf="error()" role="alert">{{ error() }}</p>

            <button type="submit" class="submit-btn" [disabled]="loading()">
              {{ loading() ? 'Checking…' : 'Sign in' }}
            </button>
          </form>

          <p class="foot">
            Hiker account?
            <a (click)="goHiker()" (keydown.enter)="goHiker()" tabindex="0" role="button">
              Sign in there instead
            </a>
          </p>
        </div>
      </div>
    </ion-content>
  `,
  styles: [
    `
      .admin-login-content {
        --background: var(--app-bg, #0d1511);
      }

      .wrap {
        min-height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px 20px;
      }

      .card {
        width: 100%;
        max-width: 400px;
        background: rgba(19, 29, 25, 0.92);
        border: 1px solid var(--app-border-strong, rgba(238, 240, 231, 0.14));
        border-radius: 22px;
        padding: 34px 26px 26px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
      }

      .mark {
        width: 52px;
        height: 52px;
        margin: 0 auto 16px;
        display: grid;
        place-items: center;
        border-radius: 16px;
        background: var(--app-accent, #8fbf6a);
        color: var(--app-on-accent, #0d1511);

        ion-icon {
          font-size: 26px;
        }
      }

      h1 {
        margin: 0;
        text-align: center;
        font-size: 22px;
        font-weight: 600;
        color: var(--app-text, #eef0e7);
      }

      .sub {
        margin: 6px 0 26px;
        text-align: center;
        font-family: var(--app-font-serif, Georgia, serif);
        font-style: italic;
        font-size: 14px;
        color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
      }

      form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      label {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
      }

      .ad-input {
        --background: rgba(13, 21, 17, 0.9);
        --color: var(--app-text, #eef0e7);
        --placeholder-color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
        --placeholder-opacity: 1;
        --border-radius: 14px;
        --border-color: var(--app-border-strong, rgba(238, 240, 231, 0.14));
        --highlight-color-focused: var(--app-accent, #8fbf6a);
        --padding-start: 14px;
        min-height: 50px;
        font-size: 14.5px;
      }

      .eye {
        color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
        font-size: 19px;
        cursor: pointer;
      }

      .err {
        margin: 0 2px;
        font-size: 11.5px;
        color: var(--ion-color-danger, #f0505a);
      }

      .form-err {
        margin: 0;
        padding: 11px 13px;
        border-radius: 12px;
        background: rgba(240, 80, 90, 0.1);
        border: 1px solid rgba(240, 80, 90, 0.3);
        font-size: 12.5px;
        line-height: 1.45;
        color: var(--ion-color-danger, #f0505a);
      }

      .submit-btn {
        min-height: 52px;
        margin-top: 4px;
        border: none;
        border-radius: 999px;
        background: var(--app-cta, #8fbf6a);
        box-shadow: var(--app-cta-shadow, 0 6px 18px rgba(143, 191, 106, 0.3)),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
        color: var(--app-on-accent, #0d1511);
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
      }

      .submit-btn:disabled {
        opacity: 0.6;
        cursor: default;
      }

      .foot {
        margin: 22px 0 0;
        text-align: center;
        font-size: 12.5px;
        color: var(--app-text-dim, rgba(238, 240, 231, 0.6));

        a {
          color: var(--app-accent, #8fbf6a);
          font-weight: 600;
          cursor: pointer;
        }
      }
    `,
  ],
})
export class AdminLoginPage {
  private fb = inject(FormBuilder);
  private auth = inject(AdminAuthService);
  private router = inject(Router);

  /**
   * Plain Angular validators, on purpose. Your hiker login uses
   * `emailValidator()` / `fieldError()` from src/app/validators/form.validators —
   * to match that exactly, import them with
   *     import { emailValidator, fieldError } from '../../../validators/form.validators';
   * swap `Validators.email` for `emailValidator()`, and replace `touched()`
   * with a `fieldError()` call. Left out here so this page compiles with no
   * dependency on a file I have not read.
   */
  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  readonly loading = signal(false);
  readonly showPw = signal(false);
  readonly error = signal('');

  constructor() {
    addIcons({ eyeOutline, eyeOffOutline, shieldCheckmarkOutline });
    // Clear the server-side message as soon as they start fixing their input.
    this.form.valueChanges.subscribe(() => this.error.set(''));
  }

  touched(name: 'email' | 'password'): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  async submit() {
    if (this.loading()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    try {
      const { email, password } = this.form.getRawValue();
      await this.auth.signIn(email, password);
      this.router.navigateByUrl('/admin', { replaceUrl: true });
    } catch (e: unknown) {
      this.error.set((e as Error)?.message ?? 'Could not sign in. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  goHiker() {
    this.router.navigateByUrl('/login');
  }
}
