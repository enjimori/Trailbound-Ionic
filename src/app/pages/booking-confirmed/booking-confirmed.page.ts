/**
 * Confirmation-page controller: resolves the booking id returned by checkout
 * and supplies receipt data and follow-up navigation to its template.
 *
 * ── THIS SCREEN NO LONGER CLAIMS THE HIKE IS CONFIRMED ────────────────────
 * Paying the deposit holds the date; an admin confirms the booking once the
 * documents, the permit, the guide and the balance are all settled. So the
 * page branches on the booking's own status: a pending booking says what has
 * actually happened and what comes next, and a confirmed one keeps the
 * celebratory version.
 *
 * Bookings made before the workflow existed have no status of this kind and
 * read as confirmed, which is what they are.
 */
import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, IonIcon, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  checkmark, timeOutline, arrowForward, warningOutline, documentAttachOutline,
  chevronForwardOutline,
} from 'ionicons/icons';

import { Booking } from '../../models/booking.model';
import { BookingService } from '../../services/booking.service';
import { CertificateService } from '../../services/certificate.service';
import { permitFor } from '../explore/trail-permits';

addIcons({
  checkmark, timeOutline, arrowForward, warningOutline, documentAttachOutline,
  chevronForwardOutline,
});

@Component({
  selector: 'app-booking-confirmed',
  standalone: true,
  templateUrl: './booking-confirmed.page.html',
  styleUrls: ['./booking-confirmed.page.scss'],
  imports: [CommonModule, IonContent, IonIcon, IonButton],
})
export class BookingConfirmedPage implements OnInit {
  /** BookingService supplies the booking created by checkout using the route id. */
  booking = signal<Booking | undefined>(undefined);

  /** "September 15, 2026" — the long form, since this is the keepsake screen. */
  prettyDate = computed(() => {
    const b = this.booking();
    if (!b?.date) return '';
    return new Date(b.date + 'T00:00:00').toLocaleDateString('en-PH', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  });

  /** A booking still working its way through. Drives the whole page's wording. */
  readonly isPending = computed(() => this.booking()?.status === 'pending');

  /** What was actually taken at checkout. Older bookings paid the lot. */
  readonly paidNow = computed(() => {
    const b = this.booking();
    if (!b) return 0;
    return b.deposit ?? b.total;
  });

  readonly balance = computed(() => {
    const b = this.booking();
    if (!b) return 0;
    return Math.max(0, b.total - (b.deposit ?? b.total));
  });

  /** "Mt. Pulag National Park — Protected Area Superintendent". */
  readonly permitOffice = computed(() => {
    const b = this.booking();
    if (!b) return '';
    return b.permitOffice || permitFor(b.trailName).office;
  });

  /** Whether this trail needs a permit at all. */
  readonly hasPermit = computed(() => {
    const b = this.booking();
    return !!b && permitFor(b.trailName).authority !== 'none';
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private bookingService: BookingService,
    public certs: CertificateService,
  ) {}

  /** Resolves the id passed by checkout so the template can show the receipt. */
  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.booking.set(this.bookingService.byId(id));
  }

  /**
   * `replaceUrl` so the back gesture cannot walk them into the checkout they
   * already paid, where a second tap would book the same hike twice.
   */
  goHome() {
    this.router.navigate(['/tabs/home'], { replaceUrl: true });
  }

  goDocuments() {
    this.router.navigate(['/documents']);
  }

  /**
   * The bookings tab, where the tracker lives.
   *
   * This is now the primary action rather than Back to home: a hiker who has
   * just paid a deposit needs to know where to watch what happens next, and
   * sending them to the home feed instead buries it.
   */
  viewBookings() {
    this.router.navigate(['/tabs/planner'], { replaceUrl: true });
  }
}