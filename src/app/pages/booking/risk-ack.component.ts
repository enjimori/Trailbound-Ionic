/**
 * The risk acknowledgment sheet.
 *
 * Two modes, one component:
 *
 *   First time (alreadyAccepted = false) — the gate. Opens over the booking
 *   page as soon as it loads, box unticked, Continue disabled until it is.
 *
 *   Review (alreadyAccepted = true) — reached from the shield button in the
 *   booking page header. The box starts ticked, and unticking it is how a
 *   hiker withdraws: the primary button turns into "Withdraw agreement" and
 *   dismisses with the 'withdraw' role, which the booking page then confirms.
 *
 * Consent that cannot be taken back is not consent, which is why review mode
 * exists at all.
 *
 * ── THE DOCUMENT GATE ─────────────────────────────────────────────────────
 * Where a trail requires a medical certificate, the sheet reads the hiker's
 * own record from CertificateService and says where it actually stands. The
 * records stream live, so a certificate approved while this sheet is open
 * updates in place.
 *
 * Missing or rejected blocks the booking outright: there is no Continue
 * button at all, only an upload. Accepting the risks does not substitute for
 * the clearance the managing office demands, and letting someone price a trip
 * they cannot take is a worse courtesy than stopping them now.
 *
 * In review does NOT block. The file exists and is with the evaluator; the
 * booking waits in awaiting_docs rather than being refused.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT SAY ───────────────────────────────────
 * It does not claim TrailBound carries no liability. A tick box cannot make
 * that true: if an organiser is negligent or ignores a known hazard, an
 * acknowledgment does not undo it.
 *
 * Dismiss roles: 'accept' | 'cancel' | 'withdraw' | 'documents'.
 * Dismiss data: { agreed: boolean } — so a tick is not lost on the way to
 * the Documents page.
 */
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, checkmarkCircle, closeOutline, cloudUploadOutline,
  documentAttachOutline, informationCircleOutline, lockClosedOutline, ticketOutline,
  timeOutline,
} from 'ionicons/icons';
import { CertificateService } from '../../services/certificate.service';
import { authorityLabel, permitFor } from '../explore/trail-permits';

/** How the hiker's medical certificate stands, for this sheet's purposes. */
type MedicalState = 'checking' | 'none' | 'pending' | 'approved' | 'rejected';

@Component({
  selector: 'app-risk-ack',
  standalone: true,
  imports: [CommonModule, IonContent, IonIcon],
  template: `
    <ion-content class="ack-content">
      <div class="sheet">
        <button type="button" class="close" (click)="cancel()" aria-label="Close">
          <ion-icon name="close-outline"></ion-icon>
        </button>

        <h2>{{ alreadyAccepted ? 'Your agreement' : 'Before you book' }}</h2>
        <p class="trail">{{ trailName }}</p>

        <section class="risks">
          <p>
            Hiking carries real risk: slips and falls, weather that turns without warning,
            exhaustion, and emergencies a long way from help.
          </p>
          <p>
            By continuing I confirm that I understand these risks, that I will follow my
            guide's instructions on the mountain, and that the fitness information and
            emergency contact I have given are accurate.
          </p>
          <p class="legal">
            This acknowledgment does not waive any right that cannot be waived by law, and
            does not excuse negligence or a failure to meet safety requirements.
          </p>
        </section>

        <section class="reqs">
          <h3>What this trail requires</h3>

          <!-- Medical certificate, with the hiker's own record folded in. -->
          <div class="req" *ngIf="permit().requiresMedical">
            <ion-icon [name]="medicalIcon()" [class]="'r-' + medicalTone()"></ion-icon>
            <div>
              <b>
                Medical certificate
                <span class="pill" [attr.data-tone]="medicalTone()">{{ medicalLabel() }}</span>
              </b>

              <small [ngSwitch]="medicalState()">
                <ng-container *ngSwitchCase="'approved'">
                  Reviewed and approved. Nothing more to do.
                </ng-container>
                <ng-container *ngSwitchCase="'pending'">
                  Received and with our reviewer. You can book this trail as soon as it is
                  approved — we will let you know.
                </ng-container>
                <ng-container *ngSwitchCase="'rejected'">
                  Your last upload was not accepted, so this trail cannot be booked yet.
                </ng-container>
                <ng-container *ngSwitchCase="'checking'">
                  Checking your documents…
                </ng-container>
                <ng-container *ngSwitchDefault>
                  Required by {{ permit().office }}. This trail cannot be booked until a
                  certificate has been uploaded.
                </ng-container>
              </small>

              <!-- The reviewer's reason, in their words. -->
              <p class="reason" *ngIf="medicalState() === 'rejected' && medicalNote()">
                “{{ medicalNote() }}”
              </p>
            </div>
          </div>

          <div class="req">
            <ion-icon name="ticket-outline" class="r-warn"></ion-icon>
            <div>
              <b>{{ authority() }}</b>
              <small>
                {{ permit().office }}
                <!--
                  The package covers this fee (its bullets list barangay
                  registration, the environmental fee and the trail fee), so
                  say "included" or a hiker reads it as a surcharge they will
                  be asked for twice.
                -->
                <span *ngIf="permit().fee">
                  · ₱{{ permit().fee }} per hiker, already included in your package
                </span>
              </small>
            </div>
          </div>

          <div class="req" *ngIf="permit().minAge">
            <ion-icon name="information-circle-outline" class="r-warn"></ion-icon>
            <div>
              <b>Minimum age {{ permit().minAge }}</b>
              <small>Enforced by the managing office at the gate.</small>
            </div>
          </div>

          <p class="note" *ngIf="permit().note">{{ permit().note }}</p>

          <p class="unverified" *ngIf="!permit().verified">
            <ion-icon name="alert-circle-outline"></ion-icon>
            Requirements for this trail have not been confirmed with the managing office yet.
            Check with them before you travel.
          </p>
        </section>

        <label class="agree">
          <input type="checkbox" [checked]="agreed()" (change)="agreed.set(!agreed())" />
          <span>I have read and understood the above.</span>
        </label>

        <!-- Review mode: the checkbox is the control. Unticked means withdraw. -->
        <ng-container *ngIf="alreadyAccepted; else firstTime">
          <button
            *ngIf="agreed(); else withdrawBtn"
            type="button"
            class="go"
            (click)="accept()"
          >
            Done
          </button>
          <ng-template #withdrawBtn>
            <button type="button" class="go danger" (click)="withdraw()">
              Withdraw agreement
            </button>
          </ng-template>
          <button type="button" class="back" (click)="cancel()">Cancel</button>
        </ng-container>

        <ng-template #firstTime>
          <!--
            Blocked: no Continue at all. A disabled button invites a hiker to
            hunt for what is wrong; replacing it with the one action that
            unblocks them does not.
          -->
          <ng-container *ngIf="blocksContinue(); else canContinue">
            <!--
              A certificate already in review needs no upload — offering one
              would only invite the hiker to replace a perfectly good
              document. They get the status and a way to check it instead.
            -->
            <button type="button" class="go" (click)="goToDocuments()">
              <ion-icon [name]="medicalState() === 'pending' ? 'time-outline' : 'cloud-upload-outline'"></ion-icon>
              {{
                medicalState() === 'pending'
                  ? 'View my documents'
                  : medicalState() === 'rejected'
                    ? 'Replace my certificate'
                    : 'Upload my certificate'
              }}
            </button>
            <p class="blocked-note">
              <ion-icon name="lock-closed-outline"></ion-icon>
              {{
                medicalState() === 'pending'
                  ? trailName + ' can be booked once your certificate has been approved.'
                  : trailName + ' cannot be booked until your medical certificate has been uploaded and approved.'
              }}
            </p>
          </ng-container>

          <ng-template #canContinue>
            <button type="button" class="go" [disabled]="!agreed()" (click)="accept()">
              Continue to checkout
            </button>
          </ng-template>

          <button type="button" class="back" (click)="cancel()">Not yet</button>
        </ng-template>

        <p class="demo">A design for a school project, not legally reviewed terms.</p>
      </div>
    </ion-content>
  `,
  styles: [`
    .ack-content { --background: var(--app-bg, #0d1511); }

    .sheet {
      position: relative;
      padding: 28px 22px 32px;
      max-width: 520px;
      margin: 0 auto;
      color: var(--app-text, #eef0e7);
    }

    .close {
      position: absolute;
      top: 14px;
      right: 14px;
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: rgba(238, 240, 231, 0.08);
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
      font-size: 20px;
    }

    h2 { margin: 0; font-size: 22px; font-weight: 600; }
    .trail {
      margin: 4px 0 22px;
      font-family: var(--app-font-serif, Georgia, serif);
      font-style: italic;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }

    .risks p { margin: 0 0 12px; font-size: 14.5px; line-height: 1.6; }
    .risks .legal { font-size: 12.5px; color: var(--app-text-dim, rgba(238, 240, 231, 0.6)); }

    .reqs {
      margin: 22px 0;
      padding: 16px 16px 14px;
      border-radius: 16px;
      background: rgba(19, 29, 25, 0.9);
      border: 1px solid var(--app-border-strong, rgba(238, 240, 231, 0.14));
    }
    h3 {
      margin: 0 0 12px;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }

    .req { display: flex; gap: 11px; align-items: flex-start; margin-bottom: 14px; }
    .req ion-icon { flex: none; font-size: 19px; margin-top: 1px; }
    .r-ok { color: #7fd09a; }
    .r-warn { color: var(--app-accent, #8fbf6a); }
    .r-stop { color: var(--ion-color-danger, #f0505a); }
    .r-muted { color: var(--app-text-dim, rgba(238, 240, 231, 0.6)); }

    .req b { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 14px; }
    .req small {
      display: block;
      margin-top: 3px;
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }
    .req strong { color: var(--app-text, #eef0e7); }

    .pill {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid currentColor;
    }
    .pill[data-tone='ok'] { color: #7fd09a; }
    .pill[data-tone='warn'] { color: #e5b457; }
    .pill[data-tone='stop'] { color: var(--ion-color-danger, #f0505a); }
    .pill[data-tone='muted'] { color: var(--app-text-dim, rgba(238, 240, 231, 0.6)); }

    /* The reviewer's own words, quoted rather than paraphrased — otherwise the
       hiker re-uploads the same unreadable photo. */
    .reason {
      margin: 8px 0 0;
      padding: 8px 11px;
      border-left: 2px solid var(--ion-color-danger, #f0505a);
      border-radius: 0 8px 8px 0;
      background: rgba(240, 80, 90, 0.08);
      font-size: 12.5px;
      line-height: 1.5;
      font-style: italic;
      color: var(--app-text, #eef0e7);
    }

    .note {
      margin: 12px 0 0;
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }

    .unverified {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin: 12px 0 0;
      padding: 10px 12px;
      border-radius: 11px;
      background: rgba(224, 169, 63, 0.1);
      border: 1px solid rgba(224, 169, 63, 0.3);
      font-size: 12px;
      line-height: 1.5;
      color: #e5b457;
    }
    .unverified ion-icon { flex: none; font-size: 16px; margin-top: 1px; }

    .agree { display: flex; gap: 11px; align-items: flex-start; margin-bottom: 18px; cursor: pointer; }
    .agree input { width: 20px; height: 20px; flex: none; margin-top: 1px; accent-color: var(--app-accent, #8fbf6a); }
    .agree span { font-size: 14px; line-height: 1.45; }

    .go {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      min-height: 52px;
      border: 0;
      border-radius: 999px;
      background: var(--app-cta, #8fbf6a);
      color: var(--app-on-accent, #0d1511);
      font-size: 15px;
      font-weight: 600;
    }
    .go:disabled { opacity: 0.45; }
    .go ion-icon { font-size: 18px; }
    .go.danger {
      background: transparent;
      border: 1px solid var(--ion-color-danger, #f0505a);
      color: var(--ion-color-danger, #f0505a);
    }

    .blocked-note {
      display: flex;
      gap: 7px;
      align-items: flex-start;
      margin: 12px 0 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--ion-color-danger, #f0505a);
    }
    .blocked-note ion-icon { flex: none; font-size: 14px; margin-top: 2px; }

    .back {
      width: 100%;
      margin-top: 10px;
      padding: 12px;
      border: 0;
      background: none;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
      font-size: 13.5px;
    }

    .demo {
      margin: 18px 0 0;
      text-align: center;
      font-size: 11px;
      color: var(--app-text-dim, rgba(238, 240, 231, 0.6));
    }
  `],
})
export class RiskAckComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private certs = inject(CertificateService);

  @Input() trailName = '';

  /** True when opened from the header button, after a previous acceptance. */
  @Input() alreadyAccepted = false;

  readonly agreed = signal(false);
  readonly permit = computed(() => permitFor(this.trailName));
  readonly authority = computed(() => authorityLabel(this.permit().authority));

  /**
   * The hiker's medical certificate. Reads the live signal, so an approval
   * that lands while this sheet is open is reflected without a reload.
   */
  readonly medicalState = computed<MedicalState>(() => {
    if (!this.certs.loaded()) return 'checking';
    return this.certs.records()['medical']?.status ?? 'none';
  });

  /** The reviewer's reason for rejecting, shown verbatim. */
  readonly medicalNote = computed(() => this.certs.records()['medical']?.note ?? '');

  /**
   * Hard block: anything short of approved.
   *
   * In review blocks too, because checkout currently takes the full package
   * price and charging for a hike an evaluator may yet refuse is worse than
   * making the hiker wait. Once the deposit split lands, relax this back to
   * `s === 'none' || s === 'rejected'` — see the matching note in
   * booking.page.ts.
   */
  readonly blocksContinue = computed(() => {
    if (!this.permit().requiresMedical) return false;
    const s = this.medicalState();
    return s !== 'approved' && s !== 'checking';
  });

  readonly medicalLabel = computed(() => {
    switch (this.medicalState()) {
      case 'approved': return 'Approved';
      case 'pending': return 'In review';
      case 'rejected': return 'Rejected';
      case 'checking': return 'Checking';
      default: return 'Not uploaded';
    }
  });

  readonly medicalTone = computed(() => {
    switch (this.medicalState()) {
      case 'approved': return 'ok';
      case 'pending': return 'warn';
      case 'rejected': return 'stop';
      case 'checking': return 'muted';
      default: return 'stop';
    }
  });

  readonly medicalIcon = computed(() => {
    switch (this.medicalState()) {
      case 'approved': return 'checkmark-circle';
      case 'pending': return 'time-outline';
      default: return 'document-attach-outline';
    }
  });

  constructor() {
    addIcons({
      alertCircleOutline, checkmarkCircle, closeOutline, cloudUploadOutline,
      documentAttachOutline, informationCircleOutline, lockClosedOutline, ticketOutline,
      timeOutline,
    });
  }

  /** Inputs are not readable at field-initialiser time, hence ngOnInit. */
  ngOnInit() {
    this.agreed.set(this.alreadyAccepted);
  }

  accept() {
    if (!this.agreed()) return;
    this.modalCtrl.dismiss({ agreed: true }, 'accept');
  }

  /** The booking page confirms this before acting on it. */
  withdraw() {
    this.modalCtrl.dismiss({ agreed: false }, 'withdraw');
  }

  /**
   * Off to Profile → Hiking Documents. The tick travels with it, so someone
   * who agreed and then went to upload does not have to agree again.
   */
  goToDocuments() {
    this.modalCtrl.dismiss({ agreed: this.agreed() }, 'documents');
  }

  /** Close without changing anything either way. */
  cancel() {
    this.modalCtrl.dismiss({ agreed: this.agreed() }, 'cancel');
  }
}