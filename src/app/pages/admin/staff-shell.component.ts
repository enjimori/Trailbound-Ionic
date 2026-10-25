/**
 * Shell for the single-screen staff areas — the permit office at /office and
 * guides at /guide.
 *
 * Deliberately small, and shared. Both roles have exactly one job and one
 * screen, so neither needs a sidebar; all that differs is the label and icon
 * in the bar, which come from the route's `data`. One file beats two that
 * drift apart.
 *
 * It carries the same `.tba` class and data-tba-theme attribute as the admin
 * shell and loads the same two stylesheets, so .tba-card, .tba-table,
 * .tba-badge and dark mode behave identically here. The handful of rules
 * below are only what differs: `.tba` is built as a sidebar-plus-column flex
 * row, and this is a single scrolling column.
 *
 * It also draws AdminUiService's toasts and confirm dialog, with the same
 * markup the admin shell uses. That is not decoration — these pages ask for a
 * permit number through ui.ask(), and with nothing rendering that dialog the
 * promise never resolves and the button looks dead.
 */
import { Component, ViewEncapsulation, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, checkmarkCircle, logOutOutline, mapOutline, moonOutline,
  ribbonOutline, sunnyOutline,
} from 'ionicons/icons';
import { signOut } from 'firebase/auth';
import { adminAuth } from './admin-firebase';
import { AdminThemeService } from './admin-theme.service';
import { AdminUiService } from './admin-ui.service';

@Component({
  selector: 'app-staff-shell',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [FormsModule, IonIcon, RouterOutlet],
  styleUrls: ['./admin-ui.css', './admin-dark.css'],
  template: `
    <div class="tba staff" [attr.data-tba-theme]="theme.mode()">
      <header class="staff-bar">
        <div class="staff-mark">
          <ion-icon [name]="icon()"></ion-icon>
          <div>
            <b>TrailBound<i>.</i></b>
            <small>{{ label() }}</small>
          </div>
        </div>
        <span class="staff-who">{{ email() }}</span>
        <button type="button" class="tba-icon-btn" (click)="theme.toggle()"
                [attr.aria-label]="theme.isDark() ? 'Switch to light mode' : 'Switch to dark mode'">
          <ion-icon [name]="theme.isDark() ? 'sunny-outline' : 'moon-outline'"></ion-icon>
        </button>
        <button type="button" class="tba-btn sm" (click)="logout()">
          <ion-icon name="log-out-outline"></ion-icon>Log out
        </button>
      </header>

      <main class="staff-page">
        <router-outlet></router-outlet>
      </main>

      <div class="tba-toasts" aria-live="polite">
        @for (t of ui.toasts(); track t.id) {
          <div class="tba-toast" [class.error]="t.tone === 'error'">
            <ion-icon [name]="t.tone === 'error' ? 'alert-circle-outline' : 'checkmark-circle'"></ion-icon>
            {{ t.message }}
          </div>
        }
      </div>

      @if (ui.dialog(); as d) {
        <div class="tba-modal-wrap" (click)="ui.close(null)">
          <div class="tba-modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
            <h3>{{ d.title }}</h3>
            <p>{{ d.message }}</p>
            @if (d.input) {
              <label class="tba-field">
                <span>{{ d.input.label }}</span>
                <input class="tba-input-box" [placeholder]="d.input.placeholder ?? ''" [(ngModel)]="d.value" maxlength="200" />
              </label>
            }
            <div class="tba-modal-actions">
              <button type="button" class="tba-btn ghost" (click)="ui.close(null)">Cancel</button>
              <button type="button" class="tba-btn" [class.danger-fill]="d.danger" [class.primary]="!d.danger" (click)="ui.close(d.value)">
                {{ d.confirmText ?? 'Confirm' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    /* .tba is a flex row built around a sidebar. This shell has none, so it
       needs the extra class to win on specificity and become a column. */
    .tba.staff { display: block; overflow-y: auto; background: var(--tba-soft); }

    .staff-bar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 14px;
      padding: 14px 24px; background: #fff; border-bottom: 1px solid var(--tba-line); }
    .staff-mark { display: flex; align-items: center; gap: 11px; margin-right: auto; }
    .staff-mark > ion-icon { font-size: 26px; color: var(--tba-sand); }
    .staff-mark b { display: block; font-size: 16px; font-weight: 700; letter-spacing: -.01em; }
    .staff-mark i { color: var(--tba-sand); font-style: normal; }
    .staff-mark small { display: block; color: var(--tba-muted); font-size: 12px; margin-top: 1px; }
    .staff-who { color: var(--tba-muted); font-size: 13px; }
    .staff-page { max-width: 1040px; margin: 0 auto; padding: 26px 24px 60px; }

    @media (max-width: 599px) {
      .staff-who { display: none; }
      .staff-bar { padding: 12px 16px; }
      .staff-page { padding: 18px 16px 40px; }
    }
  `],
})
export class StaffShellComponent {
  readonly ui = inject(AdminUiService);
  readonly theme = inject(AdminThemeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  constructor() {
    addIcons({
      alertCircleOutline, checkmarkCircle, logOutOutline, mapOutline, moonOutline,
      ribbonOutline, sunnyOutline,
    });
  }

  /** From the route's data — "Permit office", "Guide". */
  label(): string {
    return String(this.route.snapshot.data['label'] ?? 'Staff');
  }

  /** Performs the icon operation for this feature and returns its result to the caller. */
  icon(): string {
    return String(this.route.snapshot.data['icon'] ?? 'ribbon-outline');
  }

  /** Performs the email operation for this feature and returns its result to the caller. */
  email(): string {
    return adminAuth.currentUser?.email ?? '';
  }

  /** Performs the logout operation for this feature and returns its result to the caller. */
  async logout(): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Log out?',
      message: 'You will need your email and password to get back in.',
      confirmText: 'Log out',
    });
    if (!ok) return;
    await signOut(adminAuth);
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
