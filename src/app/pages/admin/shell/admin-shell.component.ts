/**
 * Admin shell — sidebar, top bar (search, notifications, account) and the shared
 * look every admin page builds on.
 *
 * The styles are global to the admin area on purpose (ViewEncapsulation.None),
 * but every selector sits under `.tba`, so nothing leaks into the hiker app.
 * Pages use these building blocks — .tba-card, .tba-table, .tba-btn,
 * .tba-badge, .tba-drawer — and only add layout.
 *
 * Those blocks live in admin-ui.css rather than inline here, because the
 * permit office shell at /office needs the same look without inheriting the
 * admin guard, sidebar or data service. One stylesheet, two shells.
 */
import { Component, OnDestroy, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chatbubblesOutline, closeOutline, gridOutline, logOutOutline, menuOutline, notificationsOutline,
  peopleOutline, phonePortraitOutline, pricetagsOutline, receiptOutline, searchOutline,
  settingsOutline, starOutline, trailSignOutline, alertCircleOutline, checkmarkCircle,
  documentAttachOutline, shieldCheckmarkOutline,
} from 'ionicons/icons';
import { Subscription, filter } from 'rxjs';

import { AdminThemeService } from '../admin-theme.service';

import { AdminAuthService } from '../admin-auth.service';
import { AdminDataService } from '../admin-data.service';
import { AdminUiService } from '../admin-ui.service';
import { AdminNotificationsService } from '../admin-notifications.service';
import { StaffBellComponent } from '../staff-bell.component';
import { initials, matches, timeAgo, tintFor } from '../admin-utils';
import { allTrails } from '../../explore/trail-lookup';
import type { AppNotification } from '../../../models/notification.model';

interface NavItem { path: string; label: string; icon: string; exact?: boolean; badge?: () => number }

interface SearchHit { kind: string; label: string; sub: string; path: string; open: string }

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, IonIcon, StaffBellComponent],
  styleUrls: ['../admin-ui.css', '../admin-dark.css'],
  template: `
    <div class="tba" [attr.data-tba-theme]="adminTheme.mode()" [class.rail-mode]="railMode()" [class.nav-open]="navOpen()">
      <aside class="tba-side" aria-label="Admin navigation">
        <a class="tba-brand" routerLink="/admin" (click)="navOpen.set(false)">
          <img src="assets/logo/trailbound-badge.png" alt="" />
          <span>TrailBound<i>.</i></span>
        </a>
        <nav class="tba-nav">
          @for (item of nav; track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: !!item.exact }"
              (click)="navOpen.set(false)"
            >
              <ion-icon [name]="item.icon"></ion-icon>
              <span>{{ item.label }}</span>
              @if (item.badge && item.badge()) { <em class="tba-count">{{ item.badge() }}</em> }
            </a>
          }
        </nav>

        <div class="tba-side-foot">
          <a href="/tabs/home" target="_blank" rel="noopener">
            <ion-icon name="phone-portrait-outline"></ion-icon><span>Open hiker app</span>
          </a>
          <button type="button" (click)="signOut()">
            <ion-icon name="log-out-outline"></ion-icon><span>Log out</span>
          </button>
        </div>
      </aside>
      <div class="tba-scrim" (click)="navOpen.set(false)"></div>

      <div class="tba-main">
        <header class="tba-top">
          <div class="tba-top-left">
            <button type="button" class="tba-burger" aria-label="Open menu" (click)="navOpen.set(true)">
              <ion-icon name="menu-outline"></ion-icon>
            </button>

            <div class="tba-search" (focusout)="onSearchBlur($event)">
              <ion-icon name="search-outline"></ion-icon>
              <input
                type="search"
                placeholder="Search hikers, bookings, trails…"
                [ngModel]="term()"
                (ngModelChange)="term.set($event); searchOpen.set(true)"
                (focus)="searchOpen.set(true)"
                (keydown.enter)="goFirst()"
                (keydown.escape)="searchOpen.set(false)"
                aria-label="Search"
              />
              @if (searchOpen() && term().trim().length > 1) {
                <div class="tba-pop tba-search-pop">
                  @for (h of hits(); track h.kind + h.open) {
                    <button type="button" class="tba-hit" (mousedown)="go(h)">
                      <em>{{ h.kind }}</em>
                      <span>{{ h.label }}</span>
                      <small>{{ h.sub }}</small>
                    </button>
                  } @empty {
                    <p class="tba-pop-empty">Nothing matches “{{ term() }}”.</p>
                  }
                </div>
              }
            </div>
          </div>

          <div class="tba-top-right">
            <!-- Hikers, the permit office and guides, live. See AdminNotificationsService. -->
            <app-staff-bell
              [items]="notes.notifications()"
              [unread]="notes.unreadCount()"
              heading="Notifications"
              empty="Nothing new from hikers, the office or guides yet."
              (pickNote)="openNote($event)"
              (markAll)="notes.markAllRead()"
            ></app-staff-bell>
            <a class="tba-me" routerLink="/admin/settings" [title]="admin()?.email ?? ''">
              <span class="tba-avatar" [style.background]="tint(admin()?.name ?? 'A')">{{ initialsOf(admin()?.name) }}</span>
            </a>
          </div>
        </header>

        @if (data.blocked().length) {
          <div class="tba-alert">
            <ion-icon name="alert-circle-outline"></ion-icon>
            <p>
              <strong>Firebase is blocking some admin data</strong>
              ({{ data.blocked().join(', ') }}). Publish the new <code>firestore.rules</code> from the
              project folder in Firebase console → Firestore Database → Rules, then reload this page.
            </p>
          </div>
        }

        <main class="tba-page">
          <router-outlet></router-outlet>
        </main>
      </div>

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
})
export class AdminShellComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AdminAuthService);
  private readonly router = inject(Router);
  readonly data = inject(AdminDataService);
  readonly ui = inject(AdminUiService);
  readonly adminTheme = inject(AdminThemeService);
  readonly notes = inject(AdminNotificationsService);

  readonly admin = this.auth.admin;
  readonly navOpen = signal(false);
  readonly railMode = signal(false);

  readonly term = signal('');
  readonly searchOpen = signal(false);

  readonly nav: NavItem[] = [
    { path: '/admin', label: 'Dashboard', icon: 'grid-outline', exact: true },
    // The badge counts bookings sitting at pending — someone has to lodge a
    // permit, review a document or confirm. It is the one number in this panel
    // that means "work is waiting", so it belongs where it is seen first.
    { path: '/admin/bookings', label: 'Bookings', icon: 'receipt-outline', badge: () => this.data.pendingBookings() },
    { path: '/admin/hikers', label: 'Hikers', icon: 'people-outline' },
    { path: '/admin/staff', label: 'Staff', icon: 'shield-checkmark-outline' },
    { path: '/admin/trails', label: 'Trails', icon: 'trail-sign-outline' },
    { path: '/admin/community', label: 'Community', icon: 'chatbubbles-outline' },
    { path: '/admin/reviews', label: 'Reviews', icon: 'star-outline' },
    { path: '/admin/certificates', label: 'Certificates', icon: 'document-attach-outline', badge: () => this.data.pendingCertificates() },
    { path: '/admin/subscription', label: 'Admin Subscription', icon: 'pricetags-outline' },
    { path: '/admin/packages', label: 'Packages', icon: 'pricetags-outline' },
    { path: '/admin/settings', label: 'Settings', icon: 'settings-outline' },
  ];

  private readonly trails = allTrails();
  private sub?: Subscription;

  readonly hits = computed<SearchHit[]>(() => {
    const q = this.term().trim();
    if (q.length < 2) return [];
    const out: SearchHit[] = [];
    for (const u of this.data.users()) {
      if (matches(q, u.name, u.email, u.phone)) {
        out.push({ kind: 'Hiker', label: u.name || u.email || 'Unnamed hiker', sub: u.email, path: '/admin/hikers', open: u.uid });
      }
    }
    for (const b of this.data.bookings()) {
      if (matches(q, b.reference, b.trailName, b.userName, b.userEmail)) {
        out.push({ kind: 'Booking', label: `#${b.reference} · ${b.trailName}`, sub: b.userName || b.userEmail || '—', path: '/admin/bookings', open: b.id });
      }
    }
    for (const t of this.trails) {
      if (matches(q, t.name, t.region)) {
        out.push({ kind: 'Trail', label: t.name, sub: t.region, path: '/admin/trails', open: t.id });
      }
    }
    for (const p of this.data.posts()) {
      if (matches(q, p.text, p.authorName)) {
        out.push({ kind: 'Post', label: p.text.slice(0, 60) || '(photo post)', sub: p.authorName, path: '/admin/community', open: p.id });
      }
    }
    return out.slice(0, 12);
  });

  constructor() {
    addIcons({
      chatbubblesOutline, closeOutline, gridOutline, logOutOutline, menuOutline, notificationsOutline,
      peopleOutline, phonePortraitOutline, pricetagsOutline, receiptOutline, searchOutline,
      settingsOutline, starOutline, trailSignOutline, alertCircleOutline, checkmarkCircle,
      documentAttachOutline, shieldCheckmarkOutline,
    });
  }

  /** Runs when the component initializes; prepares the state its template needs. */
  ngOnInit(): void {
    this.data.start();
    this.railMode.set(isDashboard(this.router.url));
    this.sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.railMode.set(isDashboard(e.urlAfterRedirects));
        this.searchOpen.set(false);
      });
  }

  /** Runs when the component is removed; releases resources owned by this component. */
  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  go(h: { path: string; open: string }): void {
    this.searchOpen.set(false);
    this.term.set('');
    this.router.navigate([h.path], { queryParams: { open: h.open } });
  }

  /** Performs the go first operation for this feature and returns its result to the caller. */
  goFirst(): void {
    const first = this.hits()[0];
    if (first) this.go(first);
  }

  /** Finalizes the search interaction when the admin search input loses focus. */
  onSearchBlur(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (!next || !(e.currentTarget as HTMLElement).contains(next)) this.searchOpen.set(false);
  }

  /** A notification was tapped: mark it read and open what it is about. */
  openNote(n: AppNotification): void {
    this.notes.markRead(n.id);
    if (n.link) this.router.navigate([n.link.path], { queryParams: n.link.queryParams });
  }

  /** Ends the current session and clears or redirects the related account state. */
  async signOut(): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Log out?',
      message: 'You will need your email and password to get back in.',
      confirmText: 'Log out',
    });
    if (!ok) return;
    this.data.stop();
    await this.auth.signOut();
    this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  ago = timeAgo;
  initialsOf = initials;
  tint = tintFor;
}

function isDashboard(url: string): boolean {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  return path === '/admin';
}
