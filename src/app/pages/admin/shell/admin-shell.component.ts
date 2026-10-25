/**
 * Admin shell — sidebar, top bar (search, activity, account) and the shared
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
import { initials, matches, timeAgo, tintFor } from '../admin-utils';
import { allTrails } from '../../explore/trail-lookup';

interface NavItem { path: string; label: string; icon: string; exact?: boolean; badge?: () => number }

interface SearchHit { kind: string; label: string; sub: string; path: string; open: string }

interface ActivityItem { at: Date; icon: string; text: string; path: string; open: string }

const SEEN_KEY = 'tba.activitySeen';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, IonIcon],
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
            <div class="tba-bell-wrap" (focusout)="onBellBlur($event)">
              <button type="button" class="tba-icon-btn" aria-label="Recent activity" (click)="toggleBell()">
                <ion-icon name="notifications-outline"></ion-icon>
                @if (unseen()) { <i class="tba-dot"></i> }
              </button>
              @if (bellOpen()) {
                <div class="tba-pop tba-bell-pop">
                  <h4>Recent activity</h4>
                  @for (a of activity(); track a.at.getTime() + a.text) {
                    <button type="button" class="tba-act" (mousedown)="openActivity(a)">
                      <ion-icon [name]="a.icon"></ion-icon>
                      <span>{{ a.text }}<small>{{ ago(a.at) }}</small></span>
                    </button>
                  } @empty {
                    <p class="tba-pop-empty">No activity yet.</p>
                  }
                </div>
              }
            </div>
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

  readonly admin = this.auth.admin;
  readonly navOpen = signal(false);
  readonly railMode = signal(false);

  readonly term = signal('');
  readonly searchOpen = signal(false);
  readonly bellOpen = signal(false);
  private readonly seenAt = signal(readSeen());

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

  readonly activity = computed<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];
    for (const b of this.data.bookings().slice(0, 15)) {
      if (!b.createdAt) continue;
      const who = b.userName || 'A hiker';
      items.push({
        at: b.createdAt, icon: 'receipt-outline', path: '/admin/bookings', open: b.id,
        text: b.status === 'cancelled' ? `Booking #${b.reference} was cancelled` : `${who} booked ${b.trailName}`,
      });
    }
    for (const p of this.data.posts().slice(0, 15)) {
      if (!p.createdAt) continue;
      items.push({
        at: p.createdAt, icon: 'chatbubbles-outline', path: '/admin/community', open: p.id,
        text: p.repostOf ? `${p.authorName} reposted a post` : `${p.authorName} posted in Community`,
      });
    }
    for (const r of this.data.reviews().slice(0, 15)) {
      if (!r.createdAt) continue;
      items.push({
        at: r.createdAt, icon: 'star-outline', path: '/admin/reviews', open: r.id,
        text: `${r.author} rated ${r.trailName} ${r.rating}★`,
      });
    }
    for (const c of this.data.certificates().slice(0, 15)) {
      if (!c.uploadedAt) continue;
      const who = this.data.userById(c.uid)?.name || c.userName || 'A hiker';
      items.push({
        at: c.uploadedAt, icon: 'document-attach-outline', path: '/admin/certificates', open: c.id,
        text: `${who} uploaded a medical certificate`,
      });
    }
    return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 10);
  });

  readonly unseen = computed(() => this.activity().some((a) => a.at.getTime() > this.seenAt()));

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
        this.bellOpen.set(false);
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

  /** Performs the toggle bell operation for this feature and returns its result to the caller. */
  toggleBell(): void {
    const open = !this.bellOpen();
    this.bellOpen.set(open);
    if (open) {
      const now = Date.now();
      this.seenAt.set(now);
      try { localStorage.setItem(SEEN_KEY, String(now)); } catch { /* private mode */ }
    }
  }

  /** Closes the notification panel when focus moves outside it. */
  onBellBlur(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (!next || !(e.currentTarget as HTMLElement).contains(next)) this.bellOpen.set(false);
  }

  /** Opens the open activity interface for the user. */
  openActivity(a: ActivityItem): void {
    this.bellOpen.set(false);
    this.router.navigate([a.path], { queryParams: { open: a.open } });
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

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
