/**
 * Admin landing page — a placeholder whose only job is to prove sign-in works.
 *
 * If you can reach this screen and it shows your name, email and role, then
 * all four moving parts are correct: Firebase config, Email/Password sign-in,
 * the users/{uid} document with role: 'admin', and the route guard. That is
 * the checkpoint before any module gets built.
 *
 * The greyed-out tiles are the modules you asked for, in the order I would
 * add them. They are labels, not links — nothing behind them yet.
 */
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircle, logOutOutline } from 'ionicons/icons';
import { AdminAuthService } from '../admin-auth.service';

@Component({
  selector: 'app-admin-home',
  standalone: true,
  imports: [CommonModule, IonContent, IonIcon],
  template: `
    <ion-content [fullscreen]="true" class="admin-home-content">
      <div class="wrap">
        <header>
          <div>
            <p class="eyebrow">TrailBound Admin</p>
            <h1>Signed in</h1>
          </div>
          <button type="button" class="signout" (click)="signOut()">
            <ion-icon name="log-out-outline"></ion-icon>
            Sign out
          </button>
        </header>

        <div class="ok">
          <ion-icon name="checkmark-circle"></ion-icon>
          <div>
            <strong>Admin access confirmed</strong>
            <p>Firebase, the role check and the route guard are all working.</p>
          </div>
        </div>

        <dl class="who" *ngIf="admin() as a">
          <div><dt>Name</dt><dd>{{ a.name }}</dd></div>
          <div><dt>Email</dt><dd>{{ a.email }}</dd></div>
          <div><dt>Role</dt><dd>{{ a.role }}</dd></div>
          <div><dt>Status</dt><dd>{{ a.status }}</dd></div>
          <div><dt>User ID</dt><dd class="mono">{{ a.uid }}</dd></div>
        </dl>

        <h2>Next</h2>
        <p class="next-note">Modules get added one at a time, in this order.</p>
        <ul class="modules">
          <li *ngFor="let m of modules">{{ m }}</li>
        </ul>
      </div>
    </ion-content>
  `,
  styles: [
    `
      .admin-home-content {
        --background: var(--app-bg, #0d1511);
      }

      .wrap {
        max-width: 720px;
        margin: 0 auto;
        padding: 28px 20px 48px;
        color: var(--app-text, #eef0e7);
      }

      header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 24px;
      }

      .eyebrow {
        margin: 0 0 2px;
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
      }

      h1 {
        margin: 0;
        font-size: 25px;
        font-weight: 600;
      }

      .signout {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 9px 15px;
        border-radius: 999px;
        border: 1px solid var(--app-border-strong, rgba(238, 240, 231, 0.14));
        background: transparent;
        color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }

      .ok {
        display: flex;
        gap: 13px;
        align-items: flex-start;
        padding: 15px 17px;
        border-radius: 16px;
        background: rgba(143, 191, 106, 0.1);
        border: 1px solid rgba(143, 191, 106, 0.32);

        ion-icon {
          flex: 0 0 auto;
          font-size: 21px;
          color: var(--app-accent, #8fbf6a);
          margin-top: 1px;
        }

        strong {
          display: block;
          font-size: 14.5px;
        }

        p {
          margin: 3px 0 0;
          font-size: 13px;
          line-height: 1.5;
          color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
        }
      }

      .who {
        margin: 22px 0 32px;
        padding: 4px 0;
        display: grid;
        gap: 1px;
        background: var(--app-border-strong, rgba(238, 240, 231, 0.14));
        border: 1px solid var(--app-border-strong, rgba(238, 240, 231, 0.14));
        border-radius: 16px;
        overflow: hidden;

        > div {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 16px;
          padding: 13px 17px;
          background: rgba(19, 29, 25, 0.92);
        }

        dt {
          font-size: 12.5px;
          color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
        }

        dd {
          margin: 0;
          font-size: 13.5px;
          font-weight: 500;
          text-align: right;
          word-break: break-all;
        }

        .mono {
          font-family: ui-monospace, 'SF Mono', Menlo, monospace;
          font-size: 11.5px;
        }
      }

      h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
      }

      .next-note {
        margin: 5px 0 14px;
        font-size: 13px;
        color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
      }

      .modules {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 8px;

        li {
          padding: 13px 16px;
          border-radius: 13px;
          border: 1px dashed var(--app-border-strong, rgba(238, 240, 231, 0.14));
          font-size: 13.5px;
          color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
        }
      }
    `,
  ],
})
export class AdminHomePage {
  private auth = inject(AdminAuthService);
  private router = inject(Router);

  readonly admin = this.auth.admin;

  readonly modules = [
    '1. Dashboard — counts and recent activity',
    '2. Users & accounts — search, suspend, promote to admin',
    '3. Bookings — status changes, refunds, cancellations',
    '4. Trails — open/closed, details, photos',
    '5. Reviews & posts — moderation',
    '6. Certificates — issue and revoke',
    '7. Merchandise — items and orders',
    '8. Packages — the rate sheet',
    '9. Subscriptions — plans and members',
  ];

  constructor() {
    addIcons({ checkmarkCircle, logOutOutline });
  }

  async signOut() {
    await this.auth.signOut();
    this.router.navigateByUrl('/admin/login', { replaceUrl: true });
  }
}
