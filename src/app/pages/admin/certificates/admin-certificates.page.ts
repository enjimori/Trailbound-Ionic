/**
 * Certificates — hikers' medical certificates.
 * Open one to see the file, then approve it or reject it with a reason the
 * hiker sees. Also lists hikers with an upcoming hike who are still missing
 * a document.
 */
import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  checkmarkCircleOutline, closeCircleOutline, closeOutline, documentAttachOutline, documentTextOutline,
  downloadOutline, medkitOutline, personOutline, searchOutline, trashOutline,
} from 'ionicons/icons';

import { AdminCertificate, AdminDataService } from '../admin-data.service';
import { AdminAuthService } from '../admin-auth.service';
import { AdminUiService } from '../admin-ui.service';
import { dayKey, fromDayKey, initials, matches, tintFor } from '../admin-utils';
import {
  CERTIFICATE_KINDS, CertificateStatus, CertificateType, certificateKind,
} from '../../../models/certificate.model';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

@Component({
  selector: 'app-admin-certificates',
  standalone: true,
  imports: [DatePipe, FormsModule, IonIcon],
  template: `
    <div class="tba-head">
      <div>
        <h1>Certificates</h1>
        <p>Medical certificates uploaded by hikers.</p>
      </div>
    </div>

    <div class="tba-toolbar">
      <label class="tba-filter">
        <ion-icon name="search-outline"></ion-icon>
        <input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Hiker name or email" />
      </label>
      <div class="tba-chips">
        @for (f of filters; track f.id) {
          <button type="button" [class.on]="filter() === f.id" (click)="filter.set(f.id)">{{ f.label }}<em>{{ counts()[f.id] }}</em></button>
        }
      </div>
      <div class="tba-chips">
        <button type="button" [class.on]="type() === ''" (click)="type.set('')">All types</button>
        @for (k of kinds; track k.id) {
          <button type="button" [class.on]="type() === k.id" (click)="type.set(k.id)">{{ k.title }}</button>
        }
      </div>
    </div>

    <div class="tba-card flush">
      @if (shown().length) {
        <div class="tba-table-wrap">
          <table class="tba-table">
            <thead>
              <tr><th>Hiker</th><th>Document</th><th class="hide-sm">Uploaded</th><th class="hide-sm">Next hike</th><th>Status</th></tr>
            </thead>
            <tbody>
              @for (c of shown(); track c.id) {
                <tr class="click" (click)="open(c.id)">
                  <td>
                    <div class="tba-who">
                      <span class="tba-avatar sm" [style.background]="tint(c.uid)">
                        @if (avatarOf(c.uid); as a) { <img [src]="a" alt="" /> } @else { {{ ini(nameOf(c)) }} }
                      </span>
                      <div><b>{{ nameOf(c) }}</b><small>{{ emailOf(c) }}</small></div>
                    </div>
                  </td>
                  <td><span class="doc"><ion-icon [name]="kind(c.type).icon"></ion-icon>{{ kind(c.type).title }}</span></td>
                  <td class="muted hide-sm">{{ c.uploadedAt | date: 'MMM d, h:mm a' }}</td>
                  <td class="muted hide-sm">{{ nextHike()[c.uid] ? (day(nextHike()[c.uid]!) | date: 'MMM d, y') : '—' }}</td>
                  <td><span class="tba-badge" [attr.data-tone]="tone(c.status)">{{ label(c.status) }}</span></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="tba-empty">
          <ion-icon name="document-attach-outline"></ion-icon>
          <h3>{{ data.certificates().length ? 'Nothing here' : 'No documents uploaded yet' }}</h3>
          <p>{{ data.certificates().length ? 'Try another filter.' : 'Hikers upload them from Profile → Hiking Documents in the app.' }}</p>
        </div>
      }
    </div>

    @if (missing().length) {
      <section class="tba-card missing">
        <h2>Upcoming hikes with missing documents</h2>
        <p class="sub">These hikers have a hike booked but have not uploaded everything yet.</p>
        <ul>
          @for (m of missing(); track m.uid) {
            <li>
              <button type="button" (click)="openHiker(m.uid)">
                <b>{{ m.name }}</b>
                <small>Hike on {{ day(m.date) | date: 'MMM d, y' }} · missing {{ m.missing.join(' and ') }}</small>
              </button>
            </li>
          }
        </ul>
      </section>
    }

    @if (selected(); as c) {
      <div class="tba-drawer-wrap" (click)="close()">
        <aside class="tba-drawer wide" (click)="$event.stopPropagation()">
          <header>
            <span class="kind-icon"><ion-icon [name]="kind(c.type).icon"></ion-icon></span>
            <div>
              <h2>{{ kind(c.type).title }}</h2>
              <p>{{ nameOf(c) }} · {{ emailOf(c) }}</p>
              <span class="tba-badge" [attr.data-tone]="tone(c.status)">{{ label(c.status) }}</span>
            </div>
            <button type="button" class="tba-icon-btn" aria-label="Close" (click)="close()"><ion-icon name="close-outline"></ion-icon></button>
          </header>

          <div class="tba-drawer-body">
            <div class="preview">
              @if (fileLoading()) {
                <p class="pv-msg">Loading the file…</p>
              } @else if (fileError()) {
                <p class="pv-msg">{{ fileError() }}</p>
              } @else if (pdfUrl()) {
                <iframe [src]="pdfUrl()" title="Document"></iframe>
              } @else if (imageUrl()) {
                <a [href]="imageUrl()" target="_blank" rel="noopener"><img [src]="imageUrl()" alt="Uploaded document" /></a>
              }
            </div>

            @if (c.status === 'rejected' && c.note) {
              <div class="note"><b>Reason given to the hiker</b><p>{{ c.note }}</p></div>
            }

            <dl class="tba-dl">
              <div><dt>File</dt><dd>{{ c.fileName }}</dd></div>
              <div><dt>Size</dt><dd>{{ kb(c.size) }}</dd></div>
              <div><dt>Uploaded</dt><dd>{{ c.uploadedAt | date: 'MMM d, y, h:mm a' }}</dd></div>
              @if (c.reviewedAt) {
                <div><dt>Reviewed</dt><dd>{{ c.reviewedAt | date: 'MMM d, y, h:mm a' }}{{ c.reviewedBy ? ' by ' + c.reviewedBy : '' }}</dd></div>
              }
              <div><dt>Next hike</dt><dd>{{ nextHike()[c.uid] ? (day(nextHike()[c.uid]!) | date: 'EEEE, MMM d, y') : 'None booked' }}</dd></div>
            </dl>

            <div class="links">
              <button type="button" class="tba-btn sm" (click)="openHiker(c.uid)"><ion-icon name="person-outline"></ion-icon>Hiker profile</button>
              @if (download(); as d) {
                <a class="tba-btn sm" [href]="d.url" [attr.download]="d.name"><ion-icon name="download-outline"></ion-icon>Download</a>
              }
            </div>
          </div>

          <footer>
            @if (c.status !== 'approved') {
              <button type="button" class="tba-btn primary" [disabled]="busy()" (click)="approve(c)"><ion-icon name="checkmark-circle-outline"></ion-icon>Approve</button>
            }
            @if (c.status !== 'rejected') {
              <button type="button" class="tba-btn danger" [disabled]="busy()" (click)="reject(c)"><ion-icon name="close-circle-outline"></ion-icon>Reject</button>
            }
            <button type="button" class="tba-btn danger icon-only" [disabled]="busy()" (click)="remove(c)" aria-label="Delete file" title="Delete file"><ion-icon name="trash-outline"></ion-icon></button>
          </footer>
        </aside>
      </div>
    }
  `,
  styles: [`
    .flush { padding: 8px 8px 4px; }
    .flush .tba-table th:first-child, .flush .tba-table td:first-child { padding-left: 14px; }
    .doc { display: inline-flex; align-items: center; gap: 7px; font-weight: 500; white-space: nowrap; }
    .doc ion-icon { font-size: 17px; color: var(--tba-muted); }
    .missing { margin-top: 16px; }
    .missing h2 { font-size: 15px; font-weight: 700; }
    .missing .sub { margin: 4px 0 12px; font-size: 12.5px; color: var(--tba-muted); }
    .missing ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
    .missing button { width: 100%; text-align: left; border: 1px solid var(--tba-line); background: #fff; border-radius: 12px; padding: 10px 12px; }
    .missing button:hover { background: var(--tba-soft); }
    .missing b { display: block; font-size: 13.5px; }
    .missing small { display: block; font-size: 12px; color: var(--tba-muted); margin-top: 2px; }
    .wide { width: min(560px, 100%) !important; }
    .kind-icon { width: 48px; height: 48px; flex: none; border-radius: 14px; display: grid; place-items: center; background: var(--tba-sand-soft); font-size: 22px; }
    header .tba-badge { margin-top: 8px; }
    .preview { min-height: 220px; margin-bottom: 18px; border-radius: 14px; background: var(--tba-soft); border: 1px solid var(--tba-line); display: grid; place-items: center; overflow: hidden; }
    .preview img { display: block; max-width: 100%; max-height: 520px; object-fit: contain; }
    .preview iframe { width: 100%; height: 520px; border: 0; background: #fff; }
    .pv-msg { color: var(--tba-muted); font-size: 13px; padding: 20px; text-align: center; }
    .note { margin: 0 0 18px; padding: 12px 14px; border-radius: 12px; background: #fbe9e8; color: #8f2f2c; font-size: 13px; }
    .note p { margin: 4px 0 0; }
    .links { display: flex; gap: 8px; flex-wrap: wrap; }
    .icon-only { margin-left: auto; width: 38px; padding: 0; }
  `],
})
export class AdminCertificatesPage implements OnDestroy {
  readonly data = inject(AdminDataService);
  private readonly auth = inject(AdminAuthService);
  private readonly ui = inject(AdminUiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  readonly kinds = CERTIFICATE_KINDS;
  readonly filters: { id: Filter; label: string }[] = [
    { id: 'pending', label: 'To review' },
    { id: 'approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' },
    { id: 'all', label: 'All' },
  ];

  readonly q = signal('');
  readonly filter = signal<Filter>('pending');
  readonly type = signal<CertificateType | ''>('');
  readonly openId = signal<string | null>(null);
  readonly busy = signal(false);

  readonly fileLoading = signal(false);
  readonly fileError = signal('');
  readonly imageUrl = signal<string | null>(null);
  readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  readonly download = signal<{ url: string; name: string } | null>(null);
  private blobUrl: string | null = null;
  private loadedFor: string | null = null;

  private readonly params = toSignal(this.route.queryParamMap);

  readonly counts = computed(() => {
    const list = this.data.certificates();
    return {
      pending: list.filter((c) => c.status === 'pending').length,
      approved: list.filter((c) => c.status === 'approved').length,
      rejected: list.filter((c) => c.status === 'rejected').length,
      all: list.length,
    };
  });

  readonly shown = computed(() => {
    const f = this.filter();
    const t = this.type();
    const q = this.q();
    return this.data.certificates().filter(
      (c) =>
        (f === 'all' || c.status === f) &&
        (!t || c.type === t) &&
        matches(q, this.nameOf(c), this.emailOf(c)),
    );
  });

  /** Earliest upcoming, not-cancelled hike date per hiker. */
  readonly nextHike = computed(() => {
    const today = dayKey(new Date());
    const map: Partial<Record<string, string>> = {};
    for (const b of this.data.bookings()) {
      if (!b.uid || b.status === 'cancelled' || b.date < today) continue;
      const cur = map[b.uid];
      if (!cur || b.date < cur) map[b.uid] = b.date;
    }
    return map;
  });

  /** Hikers with a hike coming up who still lack a document. */
  readonly missing = computed(() => {
    const next = this.nextHike();
    const out: { uid: string; name: string; date: string; missing: string[] }[] = [];
    for (const [uid, date] of Object.entries(next)) {
      if (!date) continue;
      const have = this.data.certificatesFor(uid);
      const lacking = this.kinds.filter((k) => !have[k.id]).map((k) => k.title.toLowerCase());
      if (!lacking.length) continue;
      const u = this.data.userById(uid);
      out.push({ uid, name: u?.name || u?.email || 'Hiker', date, missing: lacking });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  });

  readonly selected = computed(() => {
    const id = this.openId();
    return id ? this.data.certificates().find((c) => c.id === id) ?? null : null;
  });

  constructor() {
    addIcons({
      checkmarkCircleOutline, closeCircleOutline, closeOutline, documentAttachOutline, documentTextOutline,
      downloadOutline, medkitOutline, personOutline, searchOutline, trashOutline,
    });
    effect(() => {
      const p = this.params();
      if (!p) return;
      untracked(() => {
        const id = p.get('open');
        if (id) {
          this.filter.set('all');
          this.open(id);
        } else {
          this.openId.set(null);
        }
      });
    }, { allowSignalWrites: true });

    // Load the file once the record for the open id has arrived.
    effect(() => {
      const c = this.selected();
      if (c && this.loadedFor !== c.id) untracked(() => void this.loadFile(c));
    }, { allowSignalWrites: true });
  }

  /** Runs when the component is removed; releases resources owned by this component. */
  ngOnDestroy(): void {
    this.revoke();
  }

  /** Opens the selected record or detail view and supplies the data it needs. */
  open(id: string): void {
    this.openId.set(id);
  }

  /** Closes the active view and restores the surrounding page state. */
  close(): void {
    this.openId.set(null);
    this.loadedFor = null;
    this.revoke();
    this.imageUrl.set(null);
    this.pdfUrl.set(null);
    this.download.set(null);
    if (this.route.snapshot.queryParamMap.has('open')) {
      this.router.navigate([], { queryParams: { open: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  /** Performs the load file operation for this feature and returns its result to the caller. */
  private async loadFile(c: AdminCertificate): Promise<void> {
    this.loadedFor = c.id;
    this.fileLoading.set(true);
    this.fileError.set('');
    this.imageUrl.set(null);
    this.pdfUrl.set(null);
    this.download.set(null);
    try {
      const dataUrl = await this.data.certificateFile(c.id);
      if (this.openId() !== c.id) return;
      const blob = await (await fetch(dataUrl)).blob();
      this.revoke();
      this.blobUrl = URL.createObjectURL(blob);
      this.download.set({ url: this.blobUrl, name: c.fileName });
      if (c.mimeType === 'application/pdf') {
        this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.blobUrl));
      } else {
        this.imageUrl.set(this.blobUrl);
      }
    } catch (e) {
      const code = (e as { code?: string })?.code;
      this.fileError.set(
        code === 'permission-denied'
          ? 'Firebase refused to send the file. Publish the new firestore.rules.'
          : 'The file could not be loaded.',
      );
    } finally {
      this.fileLoading.set(false);
    }
  }

  /** Releases the temporary URL used to preview the selected certificate file. */
  private revoke(): void {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
  }

  /** Performs the approve operation for this feature and returns its result to the caller. */
  async approve(c: AdminCertificate): Promise<void> {
    await this.review(c, 'approved', '', `${this.kind(c.type).title} approved`);
  }

  /** Performs the reject operation for this feature and returns its result to the caller. */
  async reject(c: AdminCertificate): Promise<void> {
    const note = await this.ui.ask({
      title: `Reject this ${this.kind(c.type).title.toLowerCase()}?`,
      message: `${this.nameOf(c)} will see your reason in the app and can upload a new file.`,
      confirmText: 'Reject',
      danger: true,
      input: { label: 'Reason shown to the hiker', placeholder: 'e.g. The photo is blurry. Please upload a clearer copy.' },
    });
    if (note === null) return;
    await this.review(c, 'rejected', note, 'Rejected. The hiker can upload a new file.');
  }

  /** Performs the review operation for this feature and returns its result to the caller. */
  private async review(c: AdminCertificate, status: CertificateStatus, note: string, done: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.data.reviewCertificate(c.id, status, note, this.auth.admin()?.email ?? 'admin');
      this.ui.toast(done);
    } catch (e) {
      this.ui.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  /** Removes the selected record through the owning service and refreshes the view. */
  async remove(c: AdminCertificate): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Delete this file?',
      message: `${this.nameOf(c)}’s ${this.kind(c.type).title.toLowerCase()} will be deleted. They will need to upload it again.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.data.deleteCertificate(c.id);
      this.close();
      this.ui.toast('File deleted');
    } catch (e) {
      this.ui.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  /** Opens the hiker detail view for the selected record. */
  openHiker(uid: string): void {
    this.router.navigate(['/admin/hikers'], { queryParams: { open: uid } });
  }

  /** Performs the name of operation for this feature and returns its result to the caller. */
  nameOf(c: AdminCertificate): string {
    return this.data.userById(c.uid)?.name || c.userName || c.userEmail || 'Hiker';
  }

  /** Performs the email of operation for this feature and returns its result to the caller. */
  emailOf(c: AdminCertificate): string {
    return this.data.userById(c.uid)?.email || c.userEmail;
  }

  /** Performs the avatar of operation for this feature and returns its result to the caller. */
  avatarOf(uid: string): string {
    return this.data.userById(uid)?.avatar ?? '';
  }

  /** Returns the document type label used by the certificate review row. */
  kind(type: CertificateType) {
    return certificateKind(type);
  }

  /** Maps an internal value to the readable label shown in the interface. */
  label(s: CertificateStatus): string {
    return s === 'approved' ? 'Approved' : s === 'rejected' ? 'Rejected' : 'To review';
  }

  /** Maps a status value to the visual style used by the interface. */
  tone(s: CertificateStatus): string {
    return s === 'approved' ? 'green' : s === 'rejected' ? 'red' : 'amber';
  }

  /** Formats a file size in kilobytes for the certificate review list. */
  kb(bytes: number): string {
    return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  /** Converts a date key into a Date for display in the admin interface. */
  day(key: string): Date {
    return fromDayKey(key);
  }

  ini = initials;
  tint = tintFor;
}
