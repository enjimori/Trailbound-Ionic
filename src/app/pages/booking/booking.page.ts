import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController, IonContent, IonButton, IonIcon, IonDatetime, IonModal,
  ModalController, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline, arrowForward, locationOutline, checkmarkCircle, add, remove,
  leafOutline, waterOutline, trailSignOutline, keyOutline, magnetOutline,
  pricetagOutline, shieldOutline, cafeOutline, personCircleOutline, calendarOutline,
  languageOutline,
} from 'ionicons/icons';


import { Trail } from '../../models/trail.model';
import { BookingDraft, Guide, GroupHiker, MAX_GROUP_HIKERS, PackageId } from '../../models/booking.model';
import { GuideStatusService } from '../../services/guide-status.service';
import { guestCount, guideBlockReason, guideTrailReason } from '../../models/guide-ops.model';
import { BookingService } from '../../services/booking.service';
import { ACTIVITIES, GUIDES, MERCH, PACKAGES, packageById } from './booking-catalog';
import { GUIDE_PROFILES, GuideProfile, guidePhotoPath, merchPhotoPath } from './guide-profiles';
import { RiskAckComponent } from './risk-ack.component';
import { RiskAckService } from '../../services/risk-ack.service';
import { CertificateService } from '../../services/certificate.service';
import { CatalogService } from '../../services/catalog.service';
import { TrailService } from '../../services/trail.service';
import { UserService } from '../../services/user.service';


// Same lookup the Home page and the detail page use, so any of the 30 trails
// (or the seeded t1-t6) resolves here.
import { trailById } from '../explore/trail-lookup';
import { isClosed } from '../explore/trail-geo';
import { permitFor } from '../explore/trail-permits';
import { BudgetTrackerComponent } from '../../premium/budget-tracker.component';
import { MerchDiscountNoteComponent, PriorityBannerComponent } from '../../premium/booking-perks.component';


addIcons({
  arrowBackOutline, arrowForward, locationOutline, checkmarkCircle, add, remove,
  leafOutline, waterOutline, trailSignOutline, keyOutline, magnetOutline,
  pricetagOutline, shieldOutline, cafeOutline, personCircleOutline, calendarOutline,
  languageOutline,
});


/** yyyy-mm-dd from a Date, using LOCAL parts (not toISOString, which is UTC). */
function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}


/** What the acknowledgment sheet reported back. */
interface AckResult {
  role: 'accept' | 'withdraw' | 'documents' | 'cancel';
  agreed: boolean;
}


@Component({
  selector: 'app-booking',
  standalone: true,
  templateUrl: './booking.page.html',
  styleUrls: ['./booking.page.scss'],
  imports: [
    CommonModule, FormsModule, IonContent, IonButton, IonIcon, IonDatetime, IonModal,
    BudgetTrackerComponent, MerchDiscountNoteComponent, PriorityBannerComponent,
  ],
})
export class BookingPage implements OnInit {
  trail = signal<Trail | undefined>(undefined);


  /** Selections. */
  date = signal<string>('');
  packageId = signal<PackageId>('basic');
  activityIds = signal<string[]>([]);
  guideId = signal<string | null>(null);
  merch = signal<Record<string, number>>({});
  groupHikers = signal<GroupHiker[]>([]);


  private readonly catalog = inject(CatalogService);
  private readonly trailService = inject(TrailService);
  readonly packages = this.catalog.packages;
  readonly activities = ACTIVITIES;
  readonly guides = GUIDES;
  readonly merchItems = this.catalog.merch;
  readonly isClosed = isClosed;
  readonly maxGroupHikers = MAX_GROUP_HIKERS;
  readonly groupHikeAvailable = computed(() => this.trail()?.difficulty !== 'Hard');


  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);
  private riskAck = inject(RiskAckService);
  private certs = inject(CertificateService);
  private userService = inject(UserService);
  /** Each guide's availability and capacity, set by the guide on /guide. */
  private guideStatus = inject(GuideStatusService);


  /** Guards against presenting the sheet twice if the view re-enters quickly. */
  private asking = false;


  /**
   * Whether this trail's acknowledgment is currently accepted. Drives the
   * header button's state, so a hiker can see at a glance that their agreement
   * is on file.
   */
  readonly hasAgreed = computed(() => {
    const t = this.trail();
    return !!t && !!this.riskAck.acks()[t.id];
  });


  /**
   * This trail's permit and document requirements. Available to the template
   * if you want a badge on the page itself — the acknowledgment sheet shows
   * the same data.
   */
  permit = computed(() => permitFor(this.trail()?.name));


  /**
   * Whether this trail needs a medical certificate the hiker does not yet
   * have approved.
   *
   * Approved only. A certificate still in review does not pass, because
   * checkout currently takes the full package price — and charging ₱1,490 for
   * a hike that an evaluator may yet refuse is worse than making the hiker
   * wait.
   *
   * ── THIS IS A STOPGAP ─────────────────────────────────────────────────
   * Once checkout is split into a deposit and a balance, "in review" should
   * pass again: the hiker pays the small deposit to hold the date, the
   * balance unlocks on approval, and a refusal refunds in full. Blocking here
   * penalises a hiker for TrailBound's own review turnaround and leaves the
   * evaluator reviewing a certificate with no trail or date attached. Relax
   * this to `status !== 'approved' && status !== 'pending'` when that lands.
   *
   * 'checking' does not block. CertificateService sets loaded() even when the
   * read fails, so a permission error resolves to 'none' and blocks on its
   * own; blocking during the brief load would only flash a warning at someone
   * whose documents are fine.
   */
  readonly needsCertificate = computed(() => {
    if (!this.permit().requiresMedical) return false;
    if (!this.certs.loaded()) return false;
    return this.certs.records()['medical']?.status !== 'approved';
  });


  /**
   * Add-ons can only be picked when the package includes an activity
   * (Day Hike + Activity, Overnight Hike, Group Hike).
   */
  addonsAllowed = computed(
    () => (this.packages().find((item) => item.id === this.packageId())
      ?? packageById(this.packageId())).includedActivities > 0,
  );


  /** "Day Hike + Activity, Overnight Hike or Group Hike" — for the add-ons hint. */
  readonly activityPackageNames = computed(() => {
    const names = this.packages().filter(p => p.includedActivities > 0).map(p => p.name);
    return names.length > 1
      ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
      : names.join('');
  });


  /** Guide and merchandise photos that failed to load (not added yet). */
  brokenImages = signal<ReadonlySet<string>>(new Set());


  /**
   * Earliest bookable date: tomorrow.
   *
   * Tomorrow, not today: a guided hike needs a permit and a guide assigned,
   * and same-day is not a promise this app can keep.
   */
  readonly minDate: string = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return isoDate(d);
  })();


  /** Latest bookable date. Adjust to taste. */
  readonly maxDate = '2030-12-31';


  /** Text shown inside the date field: mm / dd / yyyy, or the placeholder. */
  displayDate = computed(() => {
    const iso = this.date();
    if (!iso) return 'mm / dd / yyyy';
    const [y, m, d] = iso.split('-');
    return `${m} / ${d} / ${y}`;
  });


  /** The live draft, rebuilt whenever any selection changes. */
  private draft = computed<BookingDraft | null>(() => {
    const t = this.trail();
    if (!t) return null;
    return {
      trailId: t.id,
      trailName: t.name,
      trailImage: t.image,
      trailDuration: t.duration,
      date: this.date(),
      packageId: this.packageId(),
      activityIds: this.activityIds(),
      guideId: this.guideId(),
      merch: this.merch(),
      groupHikers: this.packageId() === 'group' ? this.groupHikers() : [],
    };
  });


  quote = computed(() => {
    const d = this.draft();
    return d ? this.bookingService.quote(d) : null;
  });


  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private bookingService: BookingService,
    private toastCtrl: ToastController,
  ) {}


  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      const found = trailById(id) ?? this.trailService.getById(id);
      const trail = found ? this.catalog.withTrailOverrides([found])[0] : undefined;
      this.trail.set(trail);
      if (trail?.difficulty === 'Hard' && this.packageId() === 'group') {
        this.packageId.set('basic');
      }
    }
  }


  /**
   * The risk acknowledgment opens here, the moment the booking page is up —
   * not at Continue to checkout.
   *
   * A hiker should learn that Pulag needs a doctor's clearance before they
   * spend five minutes choosing a date, a package, a guide and a jacket. The
   * sheet costs one tap when the requirements are met and saves the whole
   * selection when they are not.
   *
   * ── WHY THIS PAGE AND NOT THE BOOK NOW BUTTON ─────────────────────────
   * Guarding here guards the route, not one button. Book Now exists on the
   * trail detail page, and more entry points tend to appear — Home, Explore, a
   * shared link straight to /booking/:id. A check on the page cannot be walked
   * around; a check on one button can.
   *
   * It also re-runs when the hiker comes back from uploading a document, so
   * the sheet shows the new status rather than the one they left behind.
   *
   * ionViewDidEnter rather than ngOnInit: presenting a modal while the page is
   * still animating in makes Ionic flicker, and occasionally leaves the sheet
   * stuck behind the page.
   */
  async ionViewDidEnter() {
    const t = this.trail();
    if (!t || this.asking) return;


    // A closed trail is refused at Continue anyway; no point asking someone to
    // acknowledge the risks of a hike they cannot book.
    if (this.isClosed(t)) return;


    if (this.riskAck.hasAccepted(t.id)) return;


    this.asking = true;
    try {
      const res = await this.presentAck(t.name, false);
      if (res.agreed) this.riskAck.accept(t.id);


      if (res.role === 'documents') {
        this.router.navigate(['/documents']);
      } else if (res.role !== 'accept') {
        // "Not yet" goes back to the trail rather than into an empty booking
        // form. replaceUrl so the back button does not bounce them straight
        // into this page again.
        this.backToTrail(t);
      }
    } finally {
      this.asking = false;
    }
  }


  /**
   * Re-opens the acknowledgment from the shield button in the page header, so
   * a hiker can read it again at any point — check their document status, or
   * withdraw.
   *
   * Consent that cannot be taken back is not consent. Withdrawing clears the
   * acceptance, which means Continue will refuse, so the confirmation says
   * plainly what is about to happen rather than letting them discover it.
   */
  async openAgreement() {
    const t = this.trail();
    if (!t || this.asking) return;


    this.asking = true;
    try {
      const wasAccepted = this.riskAck.hasAccepted(t.id);
      const res = await this.presentAck(t.name, wasAccepted);


      if (res.role === 'withdraw') {
        await this.confirmWithdraw(t);
        return;
      }


      if (res.agreed && !wasAccepted) this.riskAck.accept(t.id);
      if (res.role === 'documents') this.router.navigate(['/documents']);
      // 'cancel' changes nothing, which is the point of having it.
    } finally {
      this.asking = false;
    }
  }


  /** The warning before an agreement is actually withdrawn. */
  private async confirmWithdraw(t: Trail) {
    const alert = await this.alertCtrl.create({
      header: 'Withdraw your agreement?',
      message:
        `Without the risk acknowledgment you cannot book ${t.name}. ` +
        `Your selections on this page will be discarded and you will be taken ` +
        `back to the trail details.`,
      buttons: [
        { text: 'Keep my agreement', role: 'cancel' },
        {
          text: 'Withdraw',
          role: 'destructive',
          handler: () => {
            this.riskAck.clear(t.id);
            this.backToTrail(t);
          },
        },
      ],
    });
    await alert.present();
  }


  private backToTrail(t: Trail) {
    this.router.navigate(['/trail', t.id], { replaceUrl: true });
  }


  goBack() {
    this.location.back();
  }


  // ── date ────────────────────────────────────────────────────────────────


  selectDate(iso: string) {
    this.date.set(iso);
  }


  onDateChange(ev: CustomEvent) {
    const v = ev.detail.value;
    const iso = Array.isArray(v) ? v[0] : v;
    if (iso) this.selectDate(String(iso).slice(0, 10));
  }


  // ── package ─────────────────────────────────────────────────────────────


  selectPackage(id: PackageId) {
    if (id === 'group' && !this.groupHikeAvailable()) {
      this.toast('Group Hike is available only on Easy and Moderate trails. Hard trails require an individual medical certificate for every hiker.');
      return;
    }
    this.packageId.set(id);
    if (id === 'group' && !this.groupHikers().length) {
      const profile = this.userService.profile();
      this.groupHikers.set([{
        name: profile.name,
        address: profile.location,
        emergencyContactName: profile.emergencyContactName,
        emergencyContactPhone: profile.emergencyContactPhone,
      }]);
    }
    // Switching to a package without an activity drops any add-ons picked.
    if (!this.addonsAllowed()) this.activityIds.set([]);
  }

  setGroupHikerCount(value: number | string | null): void {
    const requested = Number(value);
    if (!Number.isFinite(requested)) return;
    const count = Math.min(MAX_GROUP_HIKERS, Math.max(1, Math.floor(requested)));
    this.groupHikers.update((hikers) => {
      if (count < hikers.length) return hikers.slice(0, count);
      return [
        ...hikers,
        ...Array.from({ length: count - hikers.length }, () => ({
          name: '',
          address: '',
          emergencyContactName: '',
          emergencyContactPhone: '',
        })),
      ];
    });
  }

  updateGroupHiker(index: number, field: keyof GroupHiker, value: string): void {
    this.groupHikers.update((hikers) => hikers.map((hiker, i) =>
      i === index ? { ...hiker, [field]: value } : hiker,
    ));
  }


  // ── activities ──────────────────────────────────────────────────────────


  toggleActivity(id: string) {
    if (!this.addonsAllowed()) return;
    this.activityIds.update(list =>
      list.includes(id) ? list.filter(a => a !== id) : [...list, id],
    );
  }


  isActivityOn(id: string): boolean {
    return this.activityIds().includes(id);
  }


  /** True when the package price already covers this one — shown as "Included". */
  isActivityCovered(id: string): boolean {
    return this.quote()?.coveredActivities.some(a => a.id === id) ?? false;
  }


  // ── guide ───────────────────────────────────────────────────────────────


  /** A guide is required, so tapping the chosen guide again keeps them chosen. */
  selectGuide(id: string) {
    const g = this.visibleGuides().find(x => x.id === id);
    if (!g) return;
    const why = this.guideBlocked(g);
    if (why) {
      this.toast(why);
      return;
    }
    this.guideId.set(id);
  }

  /**
   * The guides offered for THIS mountain: those an admin assigned to it, plus
   * any guide not yet restricted to particular mountains (which is every
   * guide until an admin assigns them, so nothing changes before then).
   */
  readonly visibleGuides = computed(() => {
    const t = this.trail();
    if (!t) return [];
    return this.guides.filter(g => this.guideStatus.canLead(g.id, t.id));
  });

  /** How many hikers this booking brings, which is what a guide's limit is checked against. */
  private readonly guests = computed(() =>
    guestCount(this.packageId() === 'group' ? this.groupHikers() : []),
  );

  /**
   * Why this guide cannot be picked for this booking (switched to Unavailable,
   * or the group is larger than they take), or null when they can.
   */
  guideBlocked(g: Guide): string | null {
    return guideBlockReason(g.name, this.guideStatus.statusFor(g.id), this.guests());
  }


  guideProfile(name: string): GuideProfile | undefined {
    return GUIDE_PROFILES[name];
  }


  guidePhoto(name: string): string {
    return guidePhotoPath(name);
  }


  // ── photos ──────────────────────────────────────────────────────────────


  merchPhoto(id: string): string {
    return merchPhotoPath(id);
  }


  markBroken(src: string) {
    this.brokenImages.update(set => new Set(set).add(src));
  }


  // ── merchandise ─────────────────────────────────────────────────────────


  merchQty(id: string): number {
    return this.merch()[id] ?? 0;
  }


  addMerch(id: string) {
    this.merch.update(m => ({ ...m, [id]: (m[id] ?? 0) + 1 }));
  }


  removeMerch(id: string) {
    this.merch.update(m => {
      const next = { ...m };
      const qty = (next[id] ?? 0) - 1;
      if (qty > 0) next[id] = qty;
      else delete next[id];
      return next;
    });
  }


  merchCount = computed(() =>
    Object.values(this.merch()).reduce((sum, n) => sum + n, 0),
  );


  // ── continue ────────────────────────────────────────────────────────────


  async proceed() {
    const t = this.trail();
    const d = this.draft();
    if (!t || !d) return;


    if (this.isClosed(t)) {
      this.toast('This trail is closed — booking is unavailable.');
      return;
    }
    if (d.packageId === 'group' && t.difficulty === 'Hard') {
      this.toast('Group Hike is available only on Easy and Moderate trails. Hard trails require an individual medical certificate for every hiker.');
      return;
    }
    if (!d.date) {
      this.toast('Pick a date first');
      return;
    }
    if (!d.guideId) {
      this.toast(this.visibleGuides().length
        ? 'Choose your expert guide'
        : 'No guide is assigned to this mountain yet, so it cannot be booked right now.');
      return;
    }
    // Re-checked here because the group can grow after a guide is picked, and
    // a guide can switch to Unavailable (or be taken off this mountain) while
    // this page is open.
    const chosenGuide = this.guides.find(g => g.id === d.guideId);
    const guideIssue = chosenGuide
      ? guideTrailReason(chosenGuide.name, this.guideStatus.trailsFor(chosenGuide.id), t.id, t.name)
        ?? this.guideBlocked(chosenGuide)
      : null;
    if (guideIssue) {
      this.toast(`${guideIssue} Choose another guide.`);
      return;
    }
    if (d.packageId === 'group') {
      const incomplete = (d.groupHikers ?? []).some((hiker) =>
        !hiker.name.trim() ||
        !hiker.address.trim() ||
        !hiker.emergencyContactName.trim() ||
        !/^\+?[\d\s()-]{7,20}$/.test(hiker.emergencyContactPhone.trim()),
      );
      if (!d.groupHikers?.length || incomplete) {
        this.toast('Complete each group hiker’s name, address, and valid emergency contact.');
        return;
      }
    }


    // The gate, enforced here as well as on entry. A sheet dismissed with the
    // hardware back button returns no 'accept' role, and a withdrawn agreement
    // leaves the page reachable — either way a booking must never reach
    // checkout without an acknowledgment recorded on it.
    if (!this.riskAck.hasAccepted(t.id)) {
      const res = await this.presentAck(t.name, false);
      if (res.agreed) this.riskAck.accept(t.id);


      if (res.role === 'documents') {
        this.router.navigate(['/documents']);
        return;
      }
      if (res.role !== 'accept') {
        this.toast('The hiking agreement has to be accepted before checkout.');
        return;
      }
    }


    // The document gate, enforced last. Accepting the risks does not stand in
    // for the clearance the managing office demands, so this refuses even a
    // fully acknowledged booking.
    if (this.needsCertificate()) {
      await this.certificateRequired(t);
      return;
    }


    this.bookingService.setDraft(d);
    this.router.navigate(['/checkout']);
  }


  /**
   * Why they cannot continue, and the one button that fixes it.
   *
   * A rejected certificate quotes the reviewer's reason — without it a hiker
   * re-uploads the same unreadable photo and is refused again.
   */
  private async certificateRequired(t: Trail) {
    const status = this.certs.records()['medical']?.status;
    const note = this.certs.records()['medical']?.note ?? '';


    if (status === 'pending') {
      // Nothing for them to do. Say so, and do not offer an upload button
      // that would only have them replace a perfectly good document.
      const alert = await this.alertCtrl.create({
        header: 'Certificate still being reviewed',
        message:
          `Your medical certificate has been received and is with our reviewer. ` +
          `You can book ${t.name} as soon as it is approved — we will let you know.`,
        buttons: [
          { text: 'OK', role: 'cancel' },
          { text: 'View my documents', handler: () => this.router.navigate(['/documents']) },
        ],
      });
      await alert.present();
      return;
    }


    const rejected = status === 'rejected';
    const message = rejected
      ? `Your medical certificate was not accepted${note ? `: “${note}”` : '.'} ` +
        `Replace it before you can book ${t.name}.`
      : `${t.name} requires a medical certificate from a licensed physician, ` +
        `asked for by ${this.permit().office}. Upload it under ` +
        `Profile → Hiking Documents to continue.`;


    const alert = await this.alertCtrl.create({
      header: rejected ? 'Certificate not accepted' : 'Medical certificate required',
      message,
      buttons: [
        { text: 'Not now', role: 'cancel' },
        {
          text: rejected ? 'Replace it' : 'Upload now',
          handler: () => this.router.navigate(['/documents']),
        },
      ],
    });
    await alert.present();
  }


  /** Shows the sheet and reports how it was dismissed. */
  private async presentAck(trailName: string, alreadyAccepted: boolean): Promise<AckResult> {
    const modal = await this.modalCtrl.create({
      component: RiskAckComponent,
      componentProps: { trailName, alreadyAccepted },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      handle: false,
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss();


    const known = role === 'accept' || role === 'withdraw' || role === 'documents';
    return {
      role: known ? (role as AckResult['role']) : 'cancel',
      // Withdrawing is never an acceptance, whatever the box said on the way out.
      agreed: role !== 'withdraw' && !!data?.agreed,
    };
  }


  private async toast(message: string) {
    const t = await this.toastCtrl.create({
      message, duration: 1800, position: 'top', color: 'dark',
    });
    t.present();
  }
}