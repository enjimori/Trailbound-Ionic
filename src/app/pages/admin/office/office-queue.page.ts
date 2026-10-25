/**
 * PERMIT OFFICE — the application queue.
 *
 * What an issuing officer sees when they sign in: the applications TrailBound
 * has sent them, the hiker's medical certificate as the basis for deciding,
 * and two decisions — issue with a reference number, or refuse with a reason.
 *
 * What is deliberately NOT here: payment details, other hikers, the community
 * feed, anything about a booking that does not bear on fitness to climb. An
 * office needs to decide whether this person may walk up this mountain on this
 * day. Everything beyond that is somebody else's business, and the Firestore
 * rules say so too — this page showing less is the visible half of that.
 */
import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { getAuth } from 'firebase/auth';
import {
  alertCircleOutline, checkmarkCircleOutline, closeCircleOutline, closeOutline,
  documentTextOutline, eyeOutline, ribbonOutline, searchOutline, shieldCheckmarkOutline,
} from 'ionicons/icons';

import { OfficeDataService, type MedicalSummary, type OfficeApplication } from './office-data.service';
import { AdminUiService } from '../admin-ui.service';
import { fromDayKey, matches } from '../admin-utils';
import { suggestedPermitRef } from './permit-ref';

type Filter = 'waiting' | 'issued' | 'refused';

@Component({
  selector: 'app-office-queue',
  standalone: true,
  imports: [DatePipe, FormsModule, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Permit applications</h1>
        <p>{{ officeName() }} · {{ office.waiting().length }} waiting on a decision</p>
      </div>
    </div>

    @if (office.error(); as err) {
      <div class="tba-alert"><ion-icon name="alert-circle-outline"></ion-icon>{{ err }}</div>
    }

    <div class="tba-toolbar">
      <label class="tba-filter">
        <ion-icon name="search-outline"></ion-icon>
        <input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Reference, trail or hiker" />
      </label>
      <div class="tba-chips">
        @for (f of filters; track f.id) {
          <button type="button" [class.on]="filter() === f.id" (click)="filter.set(f.id)">
            {{ f.label }}<em>{{ counts()[f.id] }}</em>
          </button>
        }
      </div>
    </div>

    <div class="tba-card flush">
      @if (shown().length) {
        <div class="tba-table-wrap">
          <table class="tba-table">
            <thead>
              <tr>
                <th>Application</th><th>Trail</th><th class="hide-sm">Hike date</th>
                <th class="hide-sm">Hiker</th><th>Decision</th>
              </tr>
            </thead>
            <tbody>
              @for (a of shown(); track a.id) {
                <tr class="click" (click)="openId.set(a.id)">
                  <td><b class="ref">#{{ a.reference }}</b><small class="sub">sent {{ a.lodgedAt | date: 'MMM d' }}</small></td>
                  <td><b>{{ a.trailName }}</b><small class="sub">{{ a.headcount }} {{ a.headcount === 1 ? 'hiker' : 'hikers' }}</small></td>
                  <td class="muted hide-sm">{{ hikeDate(a) | date: 'MMM d, y' }}</td>
                  <td class="hide-sm"><b>{{ a.hikerName || '—' }}</b><small class="sub">{{ a.hikerEmail }}</small></td>
                  <td>
                    <span class="tba-badge" [attr.data-tone]="tone(a)">{{ label(a) }}</span>
                    @if (a.permitRef) { <small class="sub mono">{{ a.permitRef }}</small> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="tba-empty">
          <ion-icon name="ribbon-outline"></ion-icon>
          <h3>{{ office.applications().length ? 'Nothing here' : 'No applications yet' }}</h3>
          <p>
            {{ office.applications().length
              ? 'Try another search or tab.'
              : 'Applications appear here once TrailBound sends them to your office.' }}
          </p>
        </div>
      }
    </div>

    @if (selected(); as a) {
      <div class="tba-drawer-wrap" (click)="close()">
        <aside class="tba-drawer" (click)="$event.stopPropagation()">
          <header>
            <div>
              <h2>#{{ a.reference }}</h2>
              <p>{{ a.trailName }}</p>
              <span class="tba-badge" [attr.data-tone]="tone(a)">{{ label(a) }}</span>
            </div>
            <button type="button" class="tba-icon-btn" aria-label="Close" (click)="close()">
              <ion-icon name="close-outline"></ion-icon>
            </button>
          </header>

          <div class="tba-drawer-body">
            <p class="tba-section-title">Application</p>
            <dl class="tba-dl">
              <div><dt>Hike date</dt><dd>{{ hikeDate(a) | date: 'EEEE, MMM d, y' }}</dd></div>
              <div><dt>Party size</dt><dd>{{ a.headcount }}</dd></div>
              <div><dt>Hiker</dt><dd>{{ a.hikerName || '—' }}</dd></div>
              <div><dt>Email</dt><dd>{{ a.hikerEmail || '—' }}</dd></div>
              <div><dt>Sent by TrailBound</dt><dd>{{ a.lodgedAt | date: 'MMM d, y, h:mm a' }}</dd></div>
              <div>
                <dt>Risk agreement</dt>
                <dd [class.bad]="!a.riskAckAt">
                  {{ a.riskAckAt ? 'Accepted ' + (a.riskAckAt | date: 'MMM d, y') : 'Not on record' }}
                </dd>
              </div>
            </dl>

            <!-- ── medical certificate ─────────────────────────────────── -->
            <p class="tba-section-title gap">Medical certificate</p>
            @if (medical(); as m) {
              @if (!m.exists) {
                <p class="warn-box">
                  <ion-icon name="alert-circle-outline"></ion-icon>
                  No medical certificate has been uploaded for this hiker.
                </p>
              } @else {
                <dl class="tba-dl">
                  <div><dt>TrailBound review</dt><dd>{{ reviewLabel(m) }}</dd></div>
                  <div><dt>Uploaded</dt><dd>{{ m.uploadedAt | date: 'MMM d, y' }}</dd></div>
                  @if (m.note) { <div><dt>Review note</dt><dd>{{ m.note }}</dd></div> }
                </dl>
                @if (!file()) {
                  <button type="button" class="tba-btn sm" [disabled]="busy()" (click)="viewFile(a)">
                    <ion-icon name="eye-outline"></ion-icon>View certificate
                  </button>
                  <p class="hint">
                    <ion-icon name="shield-checkmark-outline"></ion-icon>
                    This is health information. Opening it is recorded against your account
                    with the application reference, and it may only be used to decide this permit.
                  </p>
                } @else {
                  <img class="cert" [src]="file()!" alt="Medical certificate for {{ a.hikerName }}" />
                  <button type="button" class="tba-btn sm" (click)="file.set(null)">Hide certificate</button>
                }
              }
            } @else {
              <p class="muted">Checking…</p>
            }
          </div>

          <footer>
            @if (a.paperwork === 'permit_pending') {
              <button type="button" class="tba-btn primary" [disabled]="busy()" (click)="issue(a)">
                <ion-icon name="checkmark-circle-outline"></ion-icon>Issue permit
              </button>
              <button type="button" class="tba-btn danger" [disabled]="busy()" (click)="refuse(a)">
                <ion-icon name="close-circle-outline"></ion-icon>Refuse
              </button>
            } @else {
              <p class="settled">
                <ion-icon name="document-text-outline"></ion-icon>
                {{ a.paperwork === 'cleared'
                    ? 'Permit ' + a.permitRef + ' issued on ' + (a.permitIssuedAt | date: 'MMM d, y')
                    : 'This application was refused.' }}
              </p>
            }
          </footer>
        </aside>
      </div>
    }
  `,
  styles: [`
    .flush { padding: 8px 8px 4px; }
    .flush .tba-table th:first-child, .flush .tba-table td:first-child { padding-left: 14px; }
    .ref { display: block; font-weight: 600; }
    .sub { display: block; color: var(--tba-muted); font-size: 12px; margin-top: 2px; white-space: nowrap; }
    .mono { font-variant-numeric: tabular-nums; letter-spacing: .02em; }
    .gap { margin-top: 22px !important; }
    .bad { color: var(--tba-down) !important; font-weight: 600; }
    .warn-box { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 12px;
      border-radius: 10px; background: var(--tba-sand-soft); font-size: 13px; font-weight: 600; }
    .hint { display: flex; gap: 8px; margin: 10px 0 0; font-size: 12px; line-height: 1.5; color: var(--tba-muted); }
    .hint ion-icon { flex: none; font-size: 15px; margin-top: 1px; }
    .cert { display: block; width: 100%; border-radius: 12px; margin: 4px 0 10px;
      border: 1px solid var(--tba-line); background: var(--tba-sage); }
    .settled { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; color: var(--tba-muted); }
    .tba-btn[disabled] { opacity: .5; cursor: not-allowed; }
  `],
})
export class OfficeQueuePage {
  readonly office = inject(OfficeDataService);
  private readonly ui = inject(AdminUiService);

  readonly filters: { id: Filter; label: string }[] = [
    { id: 'waiting', label: 'Waiting' },
    { id: 'issued', label: 'Issued' },
    { id: 'refused', label: 'Refused' },
  ];

  readonly q = signal('');
  readonly filter = signal<Filter>('waiting');
  readonly busy = signal(false);
  readonly openId = signal<string | null>(null);
  readonly medical = signal<MedicalSummary | null>(null);
  readonly file = signal<string | null>(null);

  readonly selected = computed(() => {
    const id = this.openId();
    return id ? this.office.applications().find((a) => a.id === id) ?? null : null;
  });

  /** Taken from the applications themselves — the office is whoever they were sent to. */
  readonly officeName = computed(
    () => this.office.applications().find((a) => a.office)?.office ?? 'Permit office',
  );

  readonly counts = computed(() => {
    const c: Record<Filter, number> = { waiting: 0, issued: 0, refused: 0 };
    for (const a of this.office.applications()) c[bucket(a)]++;
    return c;
  });

  readonly shown = computed(() => {
    const f = this.filter();
    const q = this.q();
    return this.office
      .applications()
      .filter((a) => bucket(a) === f)
      .filter((a) => matches(q, a.reference, a.trailName, a.hikerName, a.hikerEmail));
  });

  constructor() {
    addIcons({
      alertCircleOutline, checkmarkCircleOutline, closeCircleOutline, closeOutline,
      documentTextOutline, eyeOutline, ribbonOutline, searchOutline, shieldCheckmarkOutline,
    });
    this.office.start();

    // Opening an application loads whether a certificate exists — never the
    // file itself. The image is one more deliberate click, because that click
    // is what gets logged.
    effect(() => {
      const a = this.selected();
      this.file.set(null);
      this.medical.set(null);
      if (!a) return;
      void this.office.medicalFor(a.hikerUid).then(
        (m) => this.medical.set(m),
        () => this.medical.set({ exists: false, status: null, fileName: '', uploadedAt: null, note: '' }),
      );
    }, { allowSignalWrites: true });
  }

  /** Closes the active view and clears the certificate from memory with it. */
  close(): void {
    this.openId.set(null);
    this.file.set(null);
    this.medical.set(null);
  }

  /** Performs the hike date operation for this feature and returns its result to the caller. */
  hikeDate(a: OfficeApplication): Date | null {
    return a.date ? fromDayKey(a.date) : null;
  }

  /** Maps an internal value to the readable label shown in the interface. */
  label(a: OfficeApplication): string {
    return a.paperwork === 'cleared' ? 'Issued' : a.paperwork === 'denied' ? 'Refused' : 'Waiting';
  }

  /** Maps a status value to the visual style used by the interface. */
  tone(a: OfficeApplication): string {
    return a.paperwork === 'cleared' ? 'green' : a.paperwork === 'denied' ? 'red' : 'amber';
  }

  /** What TrailBound made of the certificate before sending it on. */
  reviewLabel(m: MedicalSummary): string {
    switch (m.status) {
      case 'approved': return 'Checked and accepted by TrailBound';
      case 'rejected': return 'Rejected by TrailBound';
      default: return 'Not yet reviewed by TrailBound';
    }
  }

  /** Performs the view file operation for this feature and returns its result to the caller. */
  async viewFile(a: OfficeApplication): Promise<void> {
    this.busy.set(true);
    try {
      this.file.set(await this.office.openMedical(a.hikerUid, a, officerEmail()));
    } catch (e) {
      this.ui.fail(e, 'That certificate could not be opened.');
    } finally {
      this.busy.set(false);
    }
  }

  // ── decisions ────────────────────────────────────────────────────────────

  /** Performs the issue operation for this feature and returns its result to the caller. */
  async issue(a: OfficeApplication): Promise<void> {
    const ref = await this.ui.ask({
      title: `Issue permit for #${a.reference}`,
      message: `Enter your office's permit number, or keep the suggested TrailBound reference if your office does not issue one. The hiker will see this record after approval.`,
      confirmText: 'Issue permit',
      input: {
        label: 'Office permit number or TrailBound reference',
        placeholder: 'e.g. PAMO-2026-01847',
        value: suggestedPermitRef(a.reference, a.date),
      },
    });
    if (ref === null) return;
    if (!ref.trim()) {
      this.ui.toast('A permit needs its number', 'error');
      return;
    }
    this.busy.set(true);
    try {
      await this.office.issue(a, ref);
      this.ui.toast('Permit issued');
    } catch (e) {
      this.ui.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  /** Performs the refuse operation for this feature and returns its result to the caller. */
  async refuse(a: OfficeApplication): Promise<void> {
    const reason = await this.ui.ask({
      title: `Refuse #${a.reference}?`,
      message: 'The hike cannot go ahead. TrailBound will see your reason and arrange the refund with the hiker, so say enough for them to explain it.',
      confirmText: 'Refuse application',
      danger: true,
      input: { label: 'Reason', placeholder: 'e.g. Trail closed for rehabilitation that week' },
    });
    if (reason === null) return;
    if (!reason.trim()) {
      this.ui.toast('Please give a reason', 'error');
      return;
    }
    this.busy.set(true);
    try {
      await this.office.refuse(a, reason);
      this.ui.toast('Application refused');
    } catch (e) {
      this.ui.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Which tab an application belongs in. */
function bucket(a: OfficeApplication): Filter {
  return a.paperwork === 'cleared' ? 'issued' : a.paperwork === 'denied' ? 'refused' : 'waiting';
}

/**
 * Who is signed in, for the access log.
 *
 * Read straight from Firebase rather than AdminAuthService so this page does
 * not depend on the admin identity model — an officer is not an admin. Swap
 * it for the identity service if you would rather have one source.
 */
function officerEmail(): string {
  return getAuth().currentUser?.email ?? 'unknown';
}
