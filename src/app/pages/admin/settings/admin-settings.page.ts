/**
 * Settings — your admin account, changing the password, who else is an
 * admin, and whether Firebase is letting the panel read everything.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators, type AbstractControl } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { alertCircleOutline, checkmarkCircleOutline, keyOutline, logOutOutline, shieldCheckmarkOutline } from 'ionicons/icons';

import { AdminAuthService } from '../admin-auth.service';
import { AdminDataService, CollectionName } from '../admin-data.service';
import { AdminUiService } from '../admin-ui.service';
import { ADMIN_ACCOUNTS } from '../admin.config';
import { initials, tintFor } from '../admin-utils';

const COLLECTIONS: { id: CollectionName; label: string }[] = [
  { id: 'users', label: 'Hikers' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'posts', label: 'Community posts' },
  { id: 'profiles', label: 'Public profiles' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'trail_status', label: 'Trail status' },
  { id: 'certificates', label: 'Certificates' },
];

@Component({
  selector: 'app-admin-settings',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Settings</h1>
        <p>Your admin account and access.</p>
      </div>
    </div>

    <div class="cols">
      <div class="stack">
        <section class="tba-card me">
          <span class="tba-avatar lg" [style.background]="tint(admin()?.name ?? 'A')">{{ ini(admin()?.name) }}</span>
          <div>
            <h2>{{ admin()?.name }}</h2>
            <dl class="tba-dl">
              <div><dt>Username</dt><dd>{{ admin()?.username }}</dd></div>
              <div><dt>Login email</dt><dd>{{ admin()?.email }}</dd></div>
              <div><dt>Access</dt><dd>{{ admin()?.level === 'Owner' ? 'Owner (built-in account)' : 'Admin (promoted hiker)' }}</dd></div>
            </dl>
            <button type="button" class="tba-btn" (click)="signOut()"><ion-icon name="log-out-outline"></ion-icon>Log out</button>
          </div>
        </section>

        <section class="tba-card">
          <h2><ion-icon name="key-outline"></ion-icon>Change password</h2>
          <form [formGroup]="form" (ngSubmit)="changePassword()" class="pw">
            <label class="tba-field">
              <span>Current password</span>
              <input class="tba-input-box" type="password" formControlName="current" autocomplete="current-password" />
            </label>
            <label class="tba-field">
              <span>New password</span>
              <input class="tba-input-box" type="password" formControlName="next" autocomplete="new-password" />
              @if (bad('next')) { <small class="err">Use at least 8 characters.</small> }
            </label>
            <label class="tba-field">
              <span>Confirm new password</span>
              <input class="tba-input-box" type="password" formControlName="confirm" autocomplete="new-password" />
              @if (form.touched && form.errors?.['mismatch']) { <small class="err">The two new passwords do not match.</small> }
            </label>
            @if (error()) { <p class="form-err"><ion-icon name="alert-circle-outline"></ion-icon>{{ error() }}</p> }
            <button type="submit" class="tba-btn primary" [disabled]="saving()">{{ saving() ? 'Saving…' : 'Update password' }}</button>
          </form>
        </section>
      </div>

      <div class="stack">
        <section class="tba-card">
          <h2><ion-icon name="shield-checkmark-outline"></ion-icon>Admins</h2>
          <ul class="admins">
            @for (a of builtIn; track a.email) {
              <li>
                <span class="tba-avatar sm" [style.background]="tint(a.name)">{{ ini(a.name) }}</span>
                <div><b>{{ a.name }}</b><small>username “{{ a.username }}”</small></div>
                <span class="tba-badge" data-tone="ink">Owner</span>
              </li>
            }
            @for (u of promoted(); track u.uid) {
              <li>
                <span class="tba-avatar sm" [style.background]="tint(u.uid)">
                  @if (u.avatar) { <img [src]="u.avatar" alt="" /> } @else { {{ ini(u.name || u.email) }} }
                </span>
                <div><b>{{ u.name || u.email }}</b><small>{{ u.email }}</small></div>
                <span class="tba-badge" data-tone="sand">Admin</span>
              </li>
            }
          </ul>
          <p class="hint">To add an admin, open a hiker in <a routerLink="/admin/hikers">Hikers</a> and choose <b>Make admin</b>. They sign in here with their own email and password.</p>
        </section>

        <section class="tba-card">
          <h2>Data access</h2>
          <ul class="access">
            @for (c of access(); track c.id) {
              <li>
                <span>{{ c.label }}</span>
                @if (c.state === 'ok') { <span class="tba-badge" data-tone="green">Readable</span> }
                @else if (c.state === 'blocked') { <span class="tba-badge" data-tone="red">Blocked by rules</span> }
                @else { <span class="tba-badge">Loading</span> }
              </li>
            }
          </ul>
          @if (data.blocked().length) {
            <p class="hint">Publish the <code>firestore.rules</code> file from the project in Firebase console → Firestore Database → Rules, then reload.</p>
          }
        </section>
      </div>
    </div>
  `,
  styles: [`
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; align-items: start; }
    .stack { display: grid; gap: 16px; }
    h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; margin-bottom: 14px !important; }
    .me { display: flex; gap: 18px; align-items: flex-start; }
    .me > div { flex: 1; min-width: 0; }
    .me h2 { font-size: 19px; margin-bottom: 6px !important; }
    .pw { display: grid; gap: 14px; }
    .pw .tba-btn { justify-self: start; }
    .err { color: var(--tba-down); font-weight: 500; }
    .form-err { margin: 0; display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 12px; background: #fbe9e8; color: #b23a36; font-size: 13px; }
    .admins, .access { list-style: none; margin: 0; padding: 0; }
    .admins li { display: flex; align-items: center; gap: 11px; padding: 10px 0; border-bottom: 1px dashed var(--tba-line); }
    .admins li > div { flex: 1; min-width: 0; }
    .admins b { display: block; font-size: 13.5px; }
    .admins small { font-size: 12px; color: var(--tba-muted); }
    .access li { display: flex; justify-content: space-between; align-items: center; padding: 9px 0; border-bottom: 1px dashed var(--tba-line); font-size: 13.5px; }
    .hint { margin: 14px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--tba-muted); }
    .hint a { color: var(--tba-text); font-weight: 600; text-decoration: underline; }
    .hint code { background: var(--tba-soft); padding: 1px 5px; border-radius: 5px; }
  `],
})
export class AdminSettingsPage {
  private readonly auth = inject(AdminAuthService);
  readonly data = inject(AdminDataService);
  private readonly ui = inject(AdminUiService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly admin = this.auth.admin;
  readonly builtIn = ADMIN_ACCOUNTS;
  readonly promoted = computed(() => this.data.users().filter((u) => u.role === 'admin'));
  readonly saving = signal(false);
  readonly error = signal('');

  readonly access = computed(() => {
    const errors = this.data.errors();
    const loaded = this.data.loaded();
    return COLLECTIONS.map((c) => ({
      ...c,
      state: errors[c.id] ? 'blocked' : loaded[c.id] ? 'ok' : 'loading',
    }));
  });

  form = this.fb.nonNullable.group(
    {
      current: ['', Validators.required],
      next: ['', [Validators.required, Validators.minLength(8)]],
      confirm: ['', Validators.required],
    },
    { validators: (g: AbstractControl) => (g.get('next')?.value === g.get('confirm')?.value ? null : { mismatch: true }) },
  );

  constructor() {
    addIcons({ alertCircleOutline, checkmarkCircleOutline, keyOutline, logOutOutline, shieldCheckmarkOutline });
    this.form.valueChanges.subscribe(() => this.error.set(''));
  }

  bad(name: 'next'): boolean {
    const c = this.form.get(name)!;
    return c.invalid && (c.dirty || c.touched);
  }

  async changePassword(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    try {
      const { current, next } = this.form.getRawValue();
      await this.auth.changePassword(current, next);
      this.form.reset();
      this.ui.toast('Password updated');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  async signOut(): Promise<void> {
    const ok = await this.ui.confirm({ title: 'Log out?', message: 'You will need your username and password to get back in.', confirmText: 'Log out' });
    if (!ok) return;
    this.data.stop();
    await this.auth.signOut();
    this.router.navigateByUrl('/admin/login', { replaceUrl: true });
  }

  ini = initials;
  tint = tintFor;
}
