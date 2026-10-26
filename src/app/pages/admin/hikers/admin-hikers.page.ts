/**
 * Hikers — every account. Open one to see their profile, bookings, posts and
 * saved trails; suspend them, promote them to admin, or remove their data.
 */
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  banOutline, closeOutline, peopleOutline, searchOutline, shieldCheckmarkOutline, shieldOutline,
  trashOutline, checkmarkCircleOutline,
} from 'ionicons/icons';

import { AdminDataService, AdminUser, countsAsRevenue } from '../admin-data.service';
import { AdminAuthService } from '../admin-auth.service';
import { AdminUiService } from '../admin-ui.service';
import { fromDayKey, initials, matches, peso, tintFor, toDate } from '../admin-utils';
import { CERTIFICATE_KINDS } from '../../../models/certificate.model';
import { isWishlistEntry } from '../../../models/user.model';

type Filter = 'all' | 'active' | 'suspended' | 'admin';

@Component({
  selector: 'app-admin-hikers',
  standalone: true,
  imports: [DatePipe, FormsModule, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Hikers</h1>
        <p>{{ data.users().length }} accounts · {{ counts().suspended }} suspended · {{ counts().admin }} {{ counts().admin === 1 ? 'admin' : 'admins' }}</p>
      </div>
    </div>

    <div class="tba-toolbar">
      <label class="tba-filter">
        <ion-icon name="search-outline"></ion-icon>
        <input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Name, email or phone" />
      </label>
      <div class="tba-chips">
        @for (f of filters; track f.id) {
          <button type="button" [class.on]="filter() === f.id" (click)="filter.set(f.id)">{{ f.label }}<em>{{ counts()[f.id] }}</em></button>
        }
      </div>
    </div>

    <div class="tba-card flush">
      @if (shown().length) {
        <div class="tba-table-wrap">
          <table class="tba-table">
            <thead>
              <tr>
                <th>Hiker</th><th class="hide-sm">Phone</th><th class="hide-sm">Location</th>
                <th class="num">Bookings</th><th class="num hide-sm">Spent</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (u of shown(); track u.uid) {
                <tr class="click" (click)="openId.set(u.uid)">
                  <td>
                    <div class="tba-who">
                      <span class="tba-avatar sm" [style.background]="tint(u.uid)">
                        @if (u.avatar) { <img [src]="u.avatar" alt="" /> } @else { {{ ini(u.name || u.email) }} }
                      </span>
                      <div><b>{{ u.name || 'Unnamed hiker' }}</b><small>{{ u.email }}</small></div>
                    </div>
                  </td>
                  <td class="muted hide-sm">{{ u.phone || '—' }}</td>
                  <td class="muted hide-sm">{{ u.location || '—' }}</td>
                  <td class="num">{{ stats()[u.uid]?.count ?? 0 }}</td>
                  <td class="num hide-sm">{{ peso(stats()[u.uid]?.spent ?? 0) }}</td>
                  <td>
                    <span class="badges">
                      @if (u.role === 'admin') { <span class="tba-badge" data-tone="ink">Admin</span> }
                      <span class="tba-badge" [attr.data-tone]="u.status === 'suspended' ? 'red' : 'green'">{{ u.status === 'suspended' ? 'Suspended' : 'Active' }}</span>
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="tba-empty">
          <ion-icon name="people-outline"></ion-icon>
          <h3>{{ data.users().length ? 'No hikers match' : 'No hikers yet' }}</h3>
          <p>{{ data.users().length ? 'Try another search or filter.' : 'Accounts appear here as soon as someone signs up in the app.' }}</p>
        </div>
      }
    </div>

    @if (selected(); as u) {
      <div class="tba-drawer-wrap" (click)="close()">
        <aside class="tba-drawer" (click)="$event.stopPropagation()">
          <header>
            <span class="tba-avatar lg" [style.background]="tint(u.uid)">
              @if (u.avatar) { <img [src]="u.avatar" alt="" /> } @else { {{ ini(u.name || u.email) }} }
            </span>
            <div>
              <h2>{{ u.name || 'Unnamed hiker' }}</h2>
              <p>{{ u.email }}</p>
              <span class="badges top">
                @if (u.role === 'admin') { <span class="tba-badge" data-tone="ink">Admin</span> }
                <span class="tba-badge" [attr.data-tone]="u.status === 'suspended' ? 'red' : 'green'">{{ u.status === 'suspended' ? 'Suspended' : 'Active' }}</span>
              </span>
            </div>
            <button type="button" class="tba-icon-btn" aria-label="Close" (click)="close()"><ion-icon name="close-outline"></ion-icon></button>
          </header>

          <div class="tba-drawer-body">
            <div class="mini-stats">
              <div><b>{{ userBookings().length }}</b><span>Bookings</span></div>
              <div><b>{{ peso(stats()[u.uid]?.spent ?? 0) }}</b><span>Spent</span></div>
              <div><b>{{ userPosts() }}</b><span>Posts</span></div>
              <div><b>{{ userReviews() }}</b><span>Reviews</span></div>
            </div>

            <p class="tba-section-title">Profile</p>
            <dl class="tba-dl">
              <div><dt>Phone</dt><dd>{{ u.phone || '—' }}</dd></div>
              <div><dt>Birthday</dt><dd>{{ dob(u) ? (dob(u) | date: 'MMM d, y') : (u.dob || '—') }}</dd></div>
              <div><dt>Gender</dt><dd>{{ u.gender || '—' }}</dd></div>
              <div><dt>Location</dt><dd>{{ u.location || '—' }}</dd></div>
              <div><dt>Emergency contact</dt><dd>{{ u.emergencyContactName || '—' }}{{ u.emergencyContactPhone ? ' · ' + u.emergencyContactPhone : '' }}</dd></div>
              @if (u.createdAt) { <div><dt>Joined</dt><dd>{{ u.createdAt | date: 'MMM d, y' }}</dd></div> }
              <div><dt>User ID</dt><dd class="mono">{{ u.uid }}</dd></div>
            </dl>
            @if (u.bio) { <p class="bio">“{{ u.bio }}”</p> }

            <p class="tba-section-title">Hiking documents</p>
            <div class="lines">
            @for (k of kinds; track k.id) {
              @if (userCerts()[k.id]; as c) {
                <button type="button" class="line" (click)="openCertificate(c.id)">
                  <span><b>{{ k.title }}</b><small>Uploaded {{ c.uploadedAt | date: 'MMM d, y' }}</small></span>
                  <span class="tba-badge" [attr.data-tone]="c.status === 'approved' ? 'green' : c.status === 'rejected' ? 'red' : 'amber'">{{ c.status === 'approved' ? 'Approved' : c.status === 'rejected' ? 'Rejected' : 'To review' }}</span>
                </button>
              } @else {
                <div class="line static"><span><b>{{ k.title }}</b><small>Not uploaded</small></span><span class="tba-badge">Missing</span></div>
              }
            }
            </div>

            <p class="tba-section-title">Bookings</p>
            <div class="lines">
            @for (b of userBookings(); track b.id) {
              <button type="button" class="line" (click)="openBooking(b.id)">
                <span><b>{{ b.trailName }}</b><small>#{{ b.reference }} · {{ day(b.date) | date: 'MMM d, y' }}{{ b.status === 'cancelled' ? ' · Cancelled' : '' }}</small></span>
                <em>{{ peso(b.total) }}</em>
              </button>
            } @empty { <p class="none">No bookings yet.</p> }
            </div>

            <p class="tba-section-title">Wishlist</p>
            <div class="lines">
            @for (s of wishlistOf(u); track s.id) {
              <div class="line static"><span><b>{{ s.name }}</b><small>Hearted trail</small></span></div>
            } @empty { <p class="none">No hearted trails.</p> }
            </div>
          </div>

          <footer>
            @if (u.uid === me()?.uid) {
              <p class="self">This is your own account.</p>
            } @else {
              @if (u.status === 'suspended') {
                <button type="button" class="tba-btn primary" [disabled]="busy()" (click)="setStatus(u, 'active')"><ion-icon name="checkmark-circle-outline"></ion-icon>Reactivate</button>
              } @else {
                <button type="button" class="tba-btn danger" [disabled]="busy()" (click)="setStatus(u, 'suspended')"><ion-icon name="ban-outline"></ion-icon>Suspend</button>
              }
              @if (u.role === 'admin') {
                <button type="button" class="tba-btn" [disabled]="busy()" (click)="setRole(u, 'hiker')"><ion-icon name="shield-outline"></ion-icon>Remove admin</button>
              } @else {
                <button type="button" class="tba-btn" [disabled]="busy()" (click)="setRole(u, 'admin')"><ion-icon name="shield-checkmark-outline"></ion-icon>Make admin</button>
              }
              <button type="button" class="tba-btn danger icon-only" [disabled]="busy()" (click)="remove(u)" title="Delete profile data" aria-label="Delete profile data"><ion-icon name="trash-outline"></ion-icon></button>
            }
          </footer>
        </aside>
      </div>
    }
  `,
  styles: [`
    .flush { padding: 8px 8px 4px; }
    .flush .tba-table th:first-child, .flush .tba-table td:first-child { padding-left: 14px; }
    .badges { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .badges.top { margin-top: 8px; }
    .mini-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 22px; }
    .mini-stats div { background: var(--tba-soft); border-radius: 14px; padding: 12px 10px; text-align: center; }
    .mini-stats b { display: block; font-size: 15px; }
    .mini-stats span { font-size: 11.5px; color: var(--tba-muted); }
    .mono { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; }
    .bio { margin: -8px 0 22px; padding: 12px 14px; border-radius: 12px; background: var(--tba-cream); font-size: 13px; line-height: 1.5; color: var(--tba-ink-2); }
    .line { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; margin-bottom: 6px; border: 1px solid var(--tba-line); border-radius: 12px; background: #fff; text-align: left; }
    .line:not(.static):hover { background: var(--tba-soft); }
    .line b { display: block; font-size: 13.5px; }
    .line small { display: block; font-size: 12px; color: var(--tba-muted); margin-top: 2px; }
    .line em { font-style: normal; font-weight: 600; white-space: nowrap; }
    .lines { margin-bottom: 20px; }
    .lines .line:last-child { margin-bottom: 0; }
    .none { margin: 0; font-size: 13px; color: var(--tba-muted); }
    .self { margin: 0; font-size: 13px; color: var(--tba-muted); }
    .icon-only { margin-left: auto; width: 38px; padding: 0; }
  `],
})
export class AdminHikersPage {
  /** Hearted trails only — older booking copies in the same list are skipped. */
  wishlistOf(u: AdminUser) {
    return u.upcoming.filter(isWishlistEntry);
  }

  readonly data = inject(AdminDataService);
  private readonly auth = inject(AdminAuthService);
  private readonly ui = inject(AdminUiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly me = this.auth.admin;
  readonly filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'suspended', label: 'Suspended' },
    { id: 'admin', label: 'Admins' },
  ];
  readonly q = signal('');
  readonly filter = signal<Filter>('all');
  readonly openId = signal<string | null>(null);
  readonly busy = signal(false);
  private readonly params = toSignal(this.route.queryParamMap);

  readonly counts = computed(() => {
    const users = this.data.users();
    return {
      all: users.length,
      active: users.filter((u) => u.status === 'active').length,
      suspended: users.filter((u) => u.status === 'suspended').length,
      admin: users.filter((u) => u.role === 'admin').length,
    };
  });

  /** Bookings count and money spent, per uid. */
  readonly stats = computed(() => {
    const map: Partial<Record<string, { count: number; spent: number }>> = {};
    for (const b of this.data.bookings()) {
      if (!b.uid) continue;
      const s = (map[b.uid] ??= { count: 0, spent: 0 });
      s.count++;
      if (countsAsRevenue(b)) s.spent += b.total;
    }
    return map;
  });

  readonly shown = computed(() => {
    const f = this.filter();
    const q = this.q();
    return [...this.data.users()]
      .filter((u) =>
        (f === 'all' || (f === 'admin' ? u.role === 'admin' : u.status === f)) &&
        matches(q, u.name, u.email, u.phone, u.location),
      )
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0) || a.name.localeCompare(b.name));
  });

  readonly selected = computed(() => {
    const id = this.openId();
    return id ? this.data.users().find((u) => u.uid === id) ?? null : null;
  });

  readonly userBookings = computed(() => {
    const id = this.openId();
    return id ? this.data.bookings().filter((b) => b.uid === id) : [];
  });
  readonly kinds = CERTIFICATE_KINDS;
  readonly userCerts = computed(() => {
    const id = this.openId();
    return id ? this.data.certificatesFor(id) : {};
  });
  readonly userPosts = computed(() => this.data.posts().filter((p) => p.authorUid === this.openId() && !p.repostOf).length);
  readonly userReviews = computed(() => this.data.reviews().filter((r) => r.uid === this.openId()).length);

  constructor() {
    addIcons({
      banOutline, closeOutline, peopleOutline, searchOutline, shieldCheckmarkOutline, shieldOutline,
      trashOutline, checkmarkCircleOutline,
    });
    effect(() => {
      const p = this.params();
      if (!p) return;
      untracked(() => {
        if (p.get('q')) this.q.set(p.get('q')!);
        this.openId.set(p.get('open'));
      });
    }, { allowSignalWrites: true });
  }

  /** Closes the active view and restores the surrounding page state. */
  close(): void {
    this.openId.set(null);
    if (this.route.snapshot.queryParamMap.has('open')) {
      this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  /** Opens the open certificate interface for the user. */
  openCertificate(id: string): void {
    this.router.navigate(['/admin/certificates'], { queryParams: { open: id } });
  }

  /** Opens the booking detail view for the selected record. */
  openBooking(id: string): void {
    this.router.navigate(['/admin/bookings'], { queryParams: { open: id } });
  }

  /** Updates the selected record status through the owning service. */
  async setStatus(u: AdminUser, status: 'active' | 'suspended'): Promise<void> {
    if (status === 'suspended') {
      const ok = await this.ui.confirm({
        title: `Suspend ${u.name || 'this hiker'}?`,
        message: 'They are signed out of the TrailBound app and cannot sign back in until you reactivate them. Their bookings and posts stay.',
        confirmText: 'Suspend',
        danger: true,
      });
      if (!ok) return;
    }
    await this.run(() => this.data.setUserStatus(u.uid, status), status === 'suspended' ? 'Hiker suspended' : 'Hiker reactivated');
  }

  /** Updates the selected account role through the admin workflow. */
  async setRole(u: AdminUser, role: 'admin' | 'hiker'): Promise<void> {
    const ok = await this.ui.confirm(
      role === 'admin'
        ? {
            title: `Make ${u.name || 'this hiker'} an admin?`,
            message: `They can then sign in to this panel with ${u.email || 'their email'} and their own password, and see and change everything here.`,
            confirmText: 'Make admin',
          }
        : {
            title: `Remove admin from ${u.name || 'this hiker'}?`,
            message: 'They keep their hiker account but can no longer open the admin panel.',
            confirmText: 'Remove admin',
          },
    );
    if (!ok) return;
    await this.run(() => this.data.setUserRole(u.uid, role), role === 'admin' ? 'Now an admin' : 'Admin access removed');
  }

  /** Removes the selected record through the owning service and refreshes the view. */
  async remove(u: AdminUser): Promise<void> {
    const ok = await this.ui.confirm({
      title: `Delete ${u.name || 'this hiker'}’s profile data?`,
      message: 'This deletes their profile and saved trails. Their login stays in Firebase Authentication (delete it there to remove them completely), and their bookings and posts are kept. To block them instead, use Suspend.',
      confirmText: 'Delete data',
      danger: true,
    });
    if (!ok) return;
    await this.run(() => this.data.deleteUserData(u.uid), 'Profile data deleted');
    this.close();
  }

  /** Runs an admin action while showing progress and reporting its result. */
  private async run(job: () => Promise<void>, done: string): Promise<void> {
    this.busy.set(true);
    try {
      await job();
      this.ui.toast(done);
    } catch (e) {
      this.ui.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  /** Converts the hiker's stored birth date into a Date for display. */
  dob(u: AdminUser): Date | null {
    return toDate(u.dob);
  }

  /** Converts a date key into a Date for the admin interface. */
  day(key: string): Date | null {
    return key ? fromDayKey(key) : null;
  }

  peso = peso;
  ini = initials;
  tint = tintFor;
}
