/**
 * Staff — who works for TrailBound, and what they may do.
 *
 * Three roles beyond an ordinary hiker:
 *
 *   admin          the full panel
 *   permit_office  one screen: the permit applications sent to their office
 *   guide          their own assigned hikes, at /guide
 *
 * Granting a role writes users/{uid}.role, and that field is what
 * firestore.rules reads to decide what the account can touch. The rules also
 * stop an account editing its own role — otherwise any hiker who can write
 * their user document could make themselves an admin, and every other rule
 * would be decoration.
 *
 * An account is made the ordinary way, by signing up in the hiker app. There
 * is no "create user" here on purpose: passwords belong to Firebase
 * Authentication, never to a Firestore document and never to this screen.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  businessOutline, closeOutline, mapOutline, peopleOutline, searchOutline, shieldCheckmarkOutline,
} from 'ionicons/icons';
import { AdminDataService, type AdminUser, type UserRole } from '../admin-data.service';
import { AdminUiService } from '../admin-ui.service';
import { CatalogService } from '../../../services/catalog.service';
import { adminAuth } from '../admin-firebase';
import { initials, matches, tintFor } from '../admin-utils';

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  permit_office: 'Permit office',
  guide: 'Guide',
  hiker: 'Hiker',
};

const ROLE_BLURB: Record<Exclude<UserRole, 'hiker'>, string> = {
  admin: 'Everything in this panel, including granting roles.',
  permit_office: 'One screen: permit applications sent to their office, and the medical certificate behind each one.',
  guide: 'Their own assigned hikes, with the hiker\'s name and contact for the trailhead. No payments, no documents.',
};

@Component({
  selector: 'app-admin-staff',
  standalone: true,
  imports: [FormsModule, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Staff</h1>
        <p>{{ data.staff().length }} with a role beyond hiker</p>
      </div>
    </div>

    <div class="tba-card">
      <p class="tba-section-title">Current staff</p>
      @if (data.staff().length) {
        <div class="tba-table-wrap">
          <table class="tba-table">
            <thead><tr><th>Account</th><th>Role</th><th class="hide-sm">Assigned to</th><th></th></tr></thead>
            <tbody>
              @for (u of data.staff(); track u.uid) {
                <tr>
                  <td>
                    <div class="tba-who">
                      <span class="tba-avatar" [style.background]="tintFor(u.uid)">{{ initials(u.name || u.email) }}</span>
                      <div><b>{{ u.name || '—' }}</b><small>{{ u.email }}</small></div>
                    </div>
                  </td>
                  <td><span class="tba-badge" [attr.data-tone]="u.role === 'admin' ? 'ink' : 'sand'">{{ ROLE_LABEL[u.role] }}</span></td>
                  <td class="muted hide-sm">{{ assignedTo(u) }}</td>
                  <td class="num">
                    @if (isMe(u)) {
                      <small class="muted">that's you</small>
                    } @else {
                      <button type="button" class="tba-btn sm danger" [disabled]="busy()" (click)="revoke(u)">
                        Remove role
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="muted pad">Nobody has a staff role yet. Grant one below.</p>
      }
    </div>

    <div class="tba-card gap">
      <p class="tba-section-title">Grant a role</p>
      <p class="lead">
        The person signs up in the hiker app first, then you find them here.
        Search by name or email — an account only appears once it exists.
      </p>

      <label class="tba-filter wide">
        <ion-icon name="search-outline"></ion-icon>
        <input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Search hikers by name or email" />
      </label>

      @if (q().trim().length < 2) {
        <p class="muted pad">Type at least two characters.</p>
      } @else if (!found().length) {
        <p class="muted pad">No hiker matches “{{ q() }}”.</p>
      } @else {
        <div class="tba-table-wrap">
          <table class="tba-table">
            <tbody>
              @for (u of found(); track u.uid) {
                <tr>
                  <td>
                    <div class="tba-who">
                      <span class="tba-avatar" [style.background]="tintFor(u.uid)">{{ initials(u.name || u.email) }}</span>
                      <div><b>{{ u.name || '—' }}</b><small>{{ u.email }}</small></div>
                    </div>
                  </td>
                  <td class="num">
                    <div class="grant">
                      <button type="button" class="tba-btn sm" [disabled]="busy()" (click)="grant(u, 'permit_office')">
                        <ion-icon name="business-outline"></ion-icon>Permit office
                      </button>
                      <button type="button" class="tba-btn sm" [disabled]="busy()" (click)="grant(u, 'guide')">
                        <ion-icon name="map-outline"></ion-icon>Guide
                      </button>
                      <button type="button" class="tba-btn sm" [disabled]="busy()" (click)="grant(u, 'admin')">
                        <ion-icon name="shield-checkmark-outline"></ion-icon>Admin
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    <div class="tba-card gap notes">
      <p class="tba-section-title">What each role can do</p>
      <dl class="tba-dl">
        <div><dt><ion-icon name="shield-checkmark-outline"></ion-icon>Admin</dt><dd>{{ ROLE_BLURB['admin'] }}</dd></div>
        <div><dt><ion-icon name="business-outline"></ion-icon>Permit office</dt><dd>{{ ROLE_BLURB['permit_office'] }}</dd></div>
        <div><dt><ion-icon name="map-outline"></ion-icon>Guide</dt><dd>{{ ROLE_BLURB['guide'] }}</dd></div>
      </dl>
      <p class="lead">
        A permit office account signs in at the same login as everyone else and lands on
        <b>/office</b>. One account can cover every issuing body for a demo; add a second
        when a real barangay or protected-area office wants its own.
      </p>
    </div>
  `,
  styles: [`
    .gap { margin-top: 18px; }
    .pad { padding: 14px 2px; margin: 0; }
    .lead { margin: 0 0 14px; font-size: 13px; line-height: 1.6; color: var(--tba-muted); }
    .tba-filter.wide { width: 100%; max-width: 420px; margin-bottom: 8px; }
    .grant { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
    .notes dt { display: flex; align-items: center; gap: 7px; }
    .notes dd { line-height: 1.6; }
    .tba-btn[disabled] { opacity: .5; cursor: not-allowed; }
  `],
})
export class AdminStaffPage {
  readonly data = inject(AdminDataService);
  private readonly ui = inject(AdminUiService);
  /**
   * The live roster — the three guides in booking-catalog.ts plus any added
   * from Admin -> Packages. Reading the static GUIDES array here instead would
   * mean a guide you just added could never have an account linked to them,
   * with no explanation on screen.
   */
  private readonly catalog = inject(CatalogService);

  readonly q = signal('');
  readonly busy = signal(false);

  readonly initials = initials;
  readonly tintFor = tintFor;
  readonly ROLE_LABEL = ROLE_LABEL;
  readonly ROLE_BLURB = ROLE_BLURB;

  /** Hikers matching the search — staff are listed above, not here. */
  readonly found = computed(() => {
    const q = this.q().trim();
    if (q.length < 2) return [];
    return this.data.hikers().filter((u) => matches(q, u.name, u.email)).slice(0, 8);
  });

  constructor() {
    addIcons({ businessOutline, closeOutline, mapOutline, peopleOutline, searchOutline, shieldCheckmarkOutline });
  }

  /** Whoever is signed in cannot remove their own role and lock themselves out. */
  isMe(u: AdminUser): boolean {
    return u.uid === adminAuth.currentUser?.uid;
  }

  /** The office a permit officer speaks for, or the roster guide an account is. */
  assignedTo(u: AdminUser): string {
    if (u.role === 'permit_office') return u.office || '—';
    if (u.role === 'guide') {
      const g = this.catalog.guides().find((x) => x.id === u.guideRosterId);
      // A link to a roster entry that no longer exists is worth showing rather
      // than hiding: the guide sees no hikes and nobody would know why.
      return g ? g.name : u.guideRosterId ? `Unknown guide (${u.guideRosterId})` : 'Not linked';
    }
    return '—';
  }

  /** Performs the grant operation for this feature and returns its result to the caller. */
  async grant(u: AdminUser, role: Exclude<UserRole, 'hiker'>): Promise<void> {
    const who = u.name || u.email;

    // A permit office needs a name, because it is what appears on the hiker's
    // booking as the body arranging their permit. Asking for it here is the
    // only moment anybody knows which office this account speaks for.
    let detail = '';
    if (role === 'permit_office') {
      const typed = await this.ui.ask({
        title: `Which office does ${who} work for?`,
        message: 'Write it as a hiker should read it on their booking — the barangay, municipal tourism office or protected-area office that issues the permit.',
        confirmText: 'Grant access',
        input: {
          label: 'Office name',
          placeholder: 'e.g. Barangay Alfonso, Nasugbu, Batangas',
        },
      });
      if (typed === null) return;
      if (!typed.trim()) {
        this.ui.toast('An office needs a name', 'error');
        return;
      }
      detail = typed.trim();
    } else if (role === 'guide') {
      // A guide account has to be tied to a roster entry, because that id is
      // what bookings carry. Without it the account signs in to an empty
      // screen with nothing explaining why.
      const roster = this.catalog.guides();
      if (!roster.length) {
        this.ui.toast('Add a guide in Packages first — there is nobody to link to.', 'error');
        return;
      }
      const typed = await this.ui.ask({
        title: `Which guide is ${who}?`,
        message: `Type the name exactly as it appears on the roster — ${roster.map((g) => g.name).join(', ')}. Their hikes are matched by this, so it has to be one of these.`,
        confirmText: 'Grant access',
        input: { label: 'Guide on the roster', placeholder: roster[0]?.name ?? '' },
      });
      if (typed === null) return;
      const match = roster.find((g) => g.name.toLowerCase() === typed.trim().toLowerCase());
      if (!match) {
        this.ui.toast(`No guide called “${typed.trim()}” on the roster`, 'error');
        return;
      }
      detail = match.id;
    } else {
      const ok = await this.ui.confirm({
        title: `Make ${who} an admin?`,
        message: ROLE_BLURB[role],
        confirmText: 'Grant access',
        danger: true,
      });
      if (!ok) return;
    }

    await this.run(
      () => this.data.setUserRole(u.uid, role, detail),
      `${who} is now ${ROLE_LABEL[role].toLowerCase()}`,
    );
  }

  /** Performs the revoke operation for this feature and returns its result to the caller. */
  async revoke(u: AdminUser): Promise<void> {
    const who = u.name || u.email;
    const ok = await this.ui.confirm({
      title: `Remove ${who}'s role?`,
      message: `${who} goes back to being an ordinary hiker. Their account, bookings and documents are untouched — only what they may see changes.`,
      confirmText: 'Remove role',
      danger: true,
    });
    if (!ok) return;
    await this.run(() => this.data.setUserRole(u.uid, 'hiker'), `${who} is a hiker again`);
  }

  /** One write, with the busy flag and error handling both actions share. */
  private async run(write: () => Promise<void>, said: string): Promise<void> {
    this.busy.set(true);
    try {
      await write();
      this.ui.toast(said);
    } catch (e) {
      this.ui.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}