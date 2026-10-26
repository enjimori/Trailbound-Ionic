import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonIcon, IonInput,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline, arrowForward, cardOutline, qrCodeOutline, walletOutline,
  logoApple, lockClosedOutline, warningOutline, personCircleOutline,
  cloudUploadOutline, closeOutline, checkmarkCircle,
} from 'ionicons/icons';

import { BookingService } from '../../services/booking.service';
import { UserService } from '../../services/user.service';
import { guideById } from '../booking/booking-catalog';
import { balanceFor, depositFor } from '../../models/booking-workflow';
import { permitFeeFor } from '../explore/trail-permits';
import { RefundPolicyComponent } from './refund-policy.component';

addIcons({
  arrowBackOutline, arrowForward, cardOutline, qrCodeOutline, walletOutline,
  logoApple, lockClosedOutline, warningOutline, personCircleOutline,
  cloudUploadOutline, closeOutline, checkmarkCircle,
});

/** Largest proof-of-payment image accepted for QRPh. */
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const TRANSACTION_FEE = 50;

/**
 * Draws a QR-looking pattern for the demo QRPh option. It is decoration only:
 * apart from the three corner squares the cells are random, so no app can
 * scan it. A fixed seed keeps it the same every time.
 */
function demoQrPath(size = 25): string {
  const cells: string[] = [];
  const dot = (x: number, y: number) => cells.push(`M${x} ${y}h1v1h-1z`);
  const corners: [number, number][] = [[0, 0], [size - 7, 0], [0, size - 7]];
  for (const [ox, oy] of corners) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const ring = x === 0 || y === 0 || x === 6 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        if (ring || core) dot(ox + x, oy + y);
      }
    }
  }
  const inCorner = (x: number, y: number) =>
    (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
  let seed = 1490;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inCorner(x, y)) continue;
      seed = (seed * 16807) % 2147483647;
      if (seed / 2147483647 < 0.5) dot(x, y);
    }
  }
  return cells.join('');
}

interface PayMethod {
  id: string;
  label: string;
  icon: string;
  available: boolean;
}

@Component({
  selector: 'app-checkout',
  standalone: true,
  templateUrl: './checkout.page.html',
  styleUrls: ['./checkout.page.scss'],
  imports: [
    CommonModule, FormsModule, IonContent, IonHeader, IonToolbar, IonTitle,
    IonIcon, IonInput, RefundPolicyComponent,
  ],
})
export class CheckoutPage implements OnInit, OnDestroy {
  /**
   * All four methods are selectable. None of them is connected to a real
   * payment gateway. Balance checkout writes a demo-only marker to Firestore;
   * new-booking checkout remains a simulation. Set `available: false` to
   * switch one back to "Soon".
   */
  readonly methods: PayMethod[] = [
    { id: 'card', label: 'Card', icon: 'card-outline', available: true },
    { id: 'qrph', label: 'QRPh', icon: 'qr-code-outline', available: true },
    { id: 'apple', label: 'Apple Pay', icon: 'logo-apple', available: true },
    { id: 'maya', label: 'Maya', icon: 'wallet-outline', available: true },
  ];

  /** Pattern for the demo QR code (not scannable). */
  readonly qrPath = demoQrPath();

  method = signal('card');
  processing = signal(false);

  cardNumber = '';
  expiry = '';
  cvv = '';
  cardName = '';
  mayaNumber = '';

  /**
   * QRPh proof of payment. Kept in memory for this screen only, like the card
   * details — it is not uploaded anywhere and not saved with the booking.
   */
  proof = signal<{ name: string; url: string; size: string } | null>(null);

  draft = computed(() => this.bookingService.draft());

  private readonly balanceBookingId = signal<string | null>(null);
  readonly balanceCheckoutRequested = computed(() => !!this.balanceBookingId());
  readonly balanceBooking = computed(() => {
    const id = this.balanceBookingId();
    return id ? this.bookingService.bookings().find((booking) => booking.id === id) ?? null : null;
  });
  readonly balanceDue = computed(() => {
    const booking = this.balanceBooking();
    if (!booking) return 0;
    const deposit = Number(booking.deposit) || depositFor(permitFeeFor(booking.trailName), TRANSACTION_FEE);
    return balanceFor(Number(booking.total) || 0, deposit);
  });
  readonly balancePaymentEligible = computed(() => {
    const booking = this.balanceBooking();
    return !!booking
      && booking.status === 'pending'
      && booking.paperwork === 'cleared'
      && booking.payment === 'balance_due'
      && !this.bookingService.hasDemoBalancePayment(booking.id);
  });
  readonly checkoutReady = computed(() =>
    this.balanceCheckoutRequested()
      ? !!this.balanceBooking() && this.balancePaymentEligible()
      : !!this.draft() && !!this.quote(),
  );

  quote = computed(() => {
    const d = this.draft();
    return d ? this.bookingService.quote(d) : null;
  });

  guideName = computed(() => guideById(this.draft()?.guideId ?? null)?.name ?? null);

  /**
   * What the hiker is charged right now: the trail's permit fee plus the
   * transaction fee, not the whole package.
   *
   * Paying holds the date; it does not confirm the hike. The balance falls
   * due once the permit is released, and holding someone's ₱4,250 for a week
   * against a permit that might be refused is the thing that generates
   * disputes — ₱190 is not.
   */
  payNow = computed(() => this.quote()?.deposit ?? 0);

  /** What is left once the permit clears. */
  balance = computed(() => this.quote()?.balance ?? 0);

  /** "Tue, Sep 15, 2026" for the order summary. */
  prettyDate = computed(() => {
    const d = this.draft();
    if (!d?.date) return '';
    return new Date(d.date + 'T00:00:00').toLocaleDateString('en-PH', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  });

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private bookingService: BookingService,
    private userService: UserService,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit() {
    this.cardName = this.userService.profile().name;
    const balanceId = this.route.snapshot.queryParamMap.get('balance');
    if (balanceId) {
      this.balanceBookingId.set(balanceId);
      void this.loadBalanceBooking(balanceId);
      return;
    }

    // Landing here with no draft means a refresh or a stray link. The draft
    // lives in memory by design, so there is nothing to recover — send them
    // back rather than showing an empty receipt.
    if (!this.bookingService.draft()) {
      this.router.navigate(['/tabs/home'], { replaceUrl: true });
      return;
    }
  }

  ngOnDestroy() {
    this.clearProof();
  }

  goBack() {
    if (this.balanceCheckoutRequested()) {
      void this.router.navigate(['/tabs/bookings']);
      return;
    }
    this.location.back();
  }

  private async loadBalanceBooking(id: string): Promise<void> {
    await this.bookingService.refreshForCurrentUser();
    const booking = this.bookingService.bookings().find((item) => item.id === id);
    if (!booking || !this.balancePaymentEligible()) {
      await this.toast('This booking has no balance payment due.');
      await this.router.navigate(['/tabs/bookings'], { replaceUrl: true });
    }
  }

  selectMethod(m: PayMethod) {
    if (!m.available) {
      this.toast(`${m.label} is not connected yet`);
      return;
    }
    this.method.set(m.id);
  }

  // ── card input formatting ───────────────────────────────────────────────

  // Each handler also writes the cleaned value straight back into the box.
  // Binding [value] alone is not enough: when an extra digit or a letter is
  // typed, the cleaned value does not change, so Angular never redraws the
  // box and the extra character stays visible.

  /** Groups the number in fours as it is typed. Digits only, 16 max. */
  onCardNumber(ev: any) {
    const digits = String(ev.detail.value ?? '').replace(/\D/g, '').slice(0, 16);
    this.cardNumber = digits.replace(/(.{4})/g, '$1 ').trim();
    ev.target.value = this.cardNumber;
  }

  /** Inserts the slash in MM/YY. Digits only, 4 max. */
  onExpiry(ev: any) {
    const digits = String(ev.detail.value ?? '').replace(/\D/g, '').slice(0, 4);
    this.expiry = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    ev.target.value = this.expiry;
  }

  /** Digits only, 3 max (16-digit cards use a 3-digit CVV). */
  onCvv(ev: any) {
    this.cvv = String(ev.detail.value ?? '').replace(/\D/g, '').slice(0, 3);
    ev.target.value = this.cvv;
  }

  /** Maya mobile number as 0917 123 4567. Digits only, 11 max. */
  onMayaNumber(ev: any) {
    const digits = String(ev.detail.value ?? '').replace(/\D/g, '').slice(0, 11);
    this.mayaNumber = [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7)]
      .filter(Boolean)
      .join(' ');
    ev.target.value = this.mayaNumber;
  }

  // ── QRPh proof of payment ───────────────────────────────────────────────

  onProof(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // so the same file can be picked again after removing it
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.toast('Upload an image of your receipt (JPG or PNG)');
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      this.toast('That image is too large. The limit is 5 MB');
      return;
    }

    this.clearProof();
    const mb = file.size / (1024 * 1024);
    this.proof.set({
      name: file.name,
      url: URL.createObjectURL(file),
      size: mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`,
    });
  }

  removeProof() {
    this.clearProof();
  }

  private clearProof() {
    const p = this.proof();
    if (p) URL.revokeObjectURL(p.url);
    this.proof.set(null);
  }

  // submmiting payment//

  async pay() {
    if (this.processing()) return;

    const m = this.methods.find(x => x.id === this.method()) ?? this.methods[0];
    let cardLast4: string | null = null;

    if (m.id === 'card') {
      const digits = this.cardNumber.replace(/\s/g, '');

      if (digits.length !== 16) {
        this.toast('Enter a 16-digit card number');
        return;
      }
      if (!/^\d{2}\/\d{2}$/.test(this.expiry)) {
        this.toast('Enter the expiry as MM/YY');
        return;
      }
      if (this.cvv.length < 3) {
        this.toast('Enter the CVV');
        return;
      }
      if (!this.cardName.trim()) {
        this.toast('Enter the cardholder name');
        return;
      }
      cardLast4 = digits.slice(-4);
    }

    if (m.id === 'qrph' && !this.proof()) {
      this.toast('Upload your proof of payment first');
      return;
    }

    if (m.id === 'maya' && !/^09\d{9}$/.test(this.mayaNumber.replace(/\s/g, ''))) {
      this.toast('Enter your 11-digit Maya number (09XX XXX XXXX)');
      return;
    }

    if (this.balanceCheckoutRequested()) {
      const booking = this.balanceBooking();
      if (!booking || !this.balancePaymentEligible()) {
        await this.toast('This booking is no longer eligible for the balance demo.');
        await this.router.navigate(['/tabs/bookings'], { replaceUrl: true });
        return;
      }

      this.processing.set(true);
      await new Promise(resolve => setTimeout(resolve, 900));
      let recorded = false;
      try {
        const selectedMethod = this.methods.find((item) => item.id === this.method());
        recorded = await this.bookingService.simulateDemoBalancePayment(
          booking.id,
          selectedMethod?.label ?? '',
        );
      } catch (e) {
        console.error('Could not save demo balance payment marker.', e);
        await this.toast('Could not submit the balance payment. Please try again.');
        return;
      } finally {
        this.processing.set(false);
      }

      if (!recorded) {
        await this.toast('This booking is no longer eligible for the balance demo.');
        await this.router.navigate(['/tabs/bookings'], { replaceUrl: true });
        return;
      }

      await this.toast('Balance submitted. No funds were collected; your booking is awaiting confirmation.');
      await this.router.navigate(['/tabs/bookings'], {
        queryParams: { demoBalancePaid: booking.id },
        replaceUrl: true,
      });
      return;
    }

    const d = this.draft();
    if (!d) return;

    this.processing.set(true);

    // Stands in for the payment gateway round-trip. Replace this with the real
    // call when one exists; the rest of the flow does not change.
    await new Promise(resolve => setTimeout(resolve, 900));

    // Only the last four card digits are handed to the service. The full
    // number, expiry and CVV stay in this component and die with it.
    // QRPh, Apple Pay and Maya bookings have no card digits (null).
    //
    // What this charges is the DEPOSIT. confirm() writes the booking as
    // pending with payment: 'deposit_paid' — the balance is collected later,
    // once the permit is released.
    const booking = this.bookingService.confirm(d, m.label, cardLast4);

    // Bookings are no longer copied into users/{uid}.upcoming. That list is
    // now the hiker's Wishlist (hearted trails) on the Profile tab, and a
    // copy here would show every booked trail as hearted. The booking itself
    // is listed in the Bookings tab.

    this.processing.set(false);
    this.router.navigate(['/booking-confirmed', booking.id], { replaceUrl: true });
  }

  private async toast(message: string) {
    const t = await this.toastCtrl.create({
      message, duration: 1800, position: 'top', color: 'dark',
    });
    t.present();
  }
}