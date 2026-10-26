/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADMIN NOTIFICATIONS — the bell in the admin panel's top bar
 *
 * Built from AdminDataService's live listeners, so it costs no extra reads
 * and stores nothing. Grouped by who did it:
 *
 *   hikers      signed up, booked, uploaded a medical certificate, sent the
 *               balance, posted in Community, reviewed a trail
 *   the office  issued or refused a permit
 *   guides      recorded a hike as completed, or a no-show
 *
 * Replaces the old "Recent activity" list, which only covered hikers and had
 * no read state. Read marks are remembered on this device, per admin account.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Injectable, computed, inject } from '@angular/core';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline, cardOutline, chatbubblesOutline, closeCircleOutline,
  documentAttachOutline, flagOutline, peopleOutline, personAddOutline, receiptOutline, ribbonOutline, starOutline,
} from 'ionicons/icons';
import { AdminDataService } from './admin-data.service';
import { peso } from './admin-utils';
import type { AppNotification } from '../../models/notification.model';
import { summarize } from '../../models/guide-ops.model';
import {
  type NoteInput, NotificationReadState, buildFeed, minuteClock, shortDay,
} from '../../services/notification.util';

/** Posts and reviews are frequent; keep only the newest few so they don't drown out bookings. */
const COMMUNITY_LIMIT = 8;

@Injectable({ providedIn: 'root' })
export class AdminNotificationsService {
  private readonly data = inject(AdminDataService);
  private readonly readState = new NotificationReadState('tba.notifications.read');
  private readonly clock = minuteClock();

  readonly notifications = computed<AppNotification[]>(() => {
    const now = this.clock();
    const events: NoteInput[] = [];
    const nameOf = (uid: string, fallback: string) =>
      this.data.userById(uid)?.name || fallback || 'A hiker';

    // ── hikers ──
    for (const u of this.data.users()) {
      if (u.role !== 'hiker' || !u.createdAt) continue;
      events.push({
        id: `u-${u.uid}-joined`, at: u.createdAt,
        type: 'account', tone: 'accent', icon: 'person-add-outline',
        title: 'New hiker signed up',
        message: u.name ? `${u.name} · ${u.email}` : u.email || 'A new account was created.',
        link: { path: '/admin/hikers', queryParams: { open: u.uid } },
      });
    }

    for (const b of this.data.bookings()) {
      const who = nameOf(b.uid, b.userName);
      const ref = `#${b.reference}`;
      const on = b.date ? ` on ${shortDay(b.date)}` : '';
      const link = { path: '/admin/bookings', queryParams: { open: b.id } };
      const changed = b.updatedAt ?? b.createdAt;

      events.push({
        id: `b-${b.id}-new`, at: b.createdAt,
        type: 'booking', tone: 'accent', icon: 'receipt-outline',
        title: `${who} booked ${b.trailName}`,
        message: `${ref}${on} · ${peso(b.total)}${b.guideName ? ` · guide ${b.guideName}` : ''}`,
        link,
      });

      if (b.demoBalancePaid) {
        events.push({
          id: `b-${b.id}-balance`, at: b.demoBalancePaidAt ?? changed,
          type: 'booking', tone: 'success', icon: 'card-outline',
          title: `${who} sent the balance`,
          message: `${ref} · ${b.trailName} · ${b.demoBalancePaymentMethod || 'payment'} (demo). Ready to confirm.`,
          link,
        });
      }

      // ── the permit office ──
      if (b.paperwork === 'cleared' && b.permitIssuedAt) {
        events.push({
          id: `b-${b.id}-permit-issued`, at: b.permitIssuedAt,
          type: 'permit', tone: 'success', icon: 'ribbon-outline',
          title: `Permit issued · ${ref}`,
          message: `${b.permitOffice || 'The office'} issued ${b.permitRef || 'a permit'} for ${who}'s ${b.trailName} hike${on}. The balance is now due.`,
          link,
        });
      }
      if (b.paperwork === 'denied') {
        events.push({
          id: `b-${b.id}-permit-denied`, at: changed,
          type: 'permit', tone: 'danger', icon: 'close-circle-outline',
          title: `Permit refused · ${ref}`,
          message: `${b.permitOffice || 'The office'} refused ${who}'s ${b.trailName} application${b.permitNote ? `: ${b.permitNote}` : '.'}`,
          link,
        });
      }

      // ── guides ──
      if (b.status === 'completed') {
        events.push({
          id: `b-${b.id}-completed`, at: changed,
          type: 'booking', tone: 'success', icon: 'flag-outline',
          title: `Hike completed · ${ref}`,
          message: `${b.guideName || 'The guide'} recorded that ${who} hiked ${b.trailName}${on}.`,
          link,
        });
      }
      if (b.status === 'no_show') {
        events.push({
          id: `b-${b.id}-noshow`, at: changed,
          type: 'booking', tone: 'danger', icon: 'alert-circle-outline',
          title: `No-show · ${ref}`,
          message: `${b.guideName || 'The guide'} recorded that ${who} did not turn up for ${b.trailName}${on}.`,
          link,
        });
      }
    }

    // ── guides: attendance checklists ──
    const bookingById = new Map(this.data.bookings().map((b) => [b.id, b]));
    for (const rec of Object.values(this.data.attendance())) {
      if (!rec.updatedAt) continue;
      const b = bookingById.get(rec.bookingId);
      const s = summarize(rec);
      const ref = `#${b?.reference || rec.reference}`;
      events.push({
        // The save time is in the id, so a corrected checklist shows up again.
        id: `a-${rec.bookingId}-${rec.updatedAt.getTime()}`, at: rec.updatedAt,
        type: 'booking', tone: s.absent === 0 ? 'success' : s.present === 0 ? 'danger' : 'warning',
        icon: 'people-outline',
        title: `Attendance taken · ${ref}`,
        message: `${b?.guideName || 'The guide'} marked ${s.present} present and ${s.absent} absent for ${b?.trailName || rec.trailName}.`,
        link: { path: '/admin/bookings', queryParams: { open: rec.bookingId } },
      });
    }

    for (const c of this.data.certificates()) {
      if (!c.uploadedAt) continue;
      const who = nameOf(c.uid, c.userName);
      events.push({
        id: `c-${c.id}-${c.uploadedAt.getTime()}`, at: c.uploadedAt,
        type: 'document', tone: c.status === 'pending' ? 'warning' : 'info', icon: 'document-attach-outline',
        title: `${who} uploaded a medical certificate`,
        message: c.status === 'pending' ? 'Waiting for your review.' : `Reviewed: ${c.status}.`,
        link: { path: '/admin/certificates', queryParams: { open: c.id } },
      });
    }

    for (const p of this.data.posts().slice(0, COMMUNITY_LIMIT)) {
      if (!p.createdAt) continue;
      const text = p.text.trim();
      events.push({
        id: `p-${p.id}`, at: p.createdAt,
        type: 'community', tone: 'info', icon: 'chatbubbles-outline',
        title: p.repostOf ? `${p.authorName} reposted a post` : `${p.authorName} posted in Community`,
        message: text ? (text.length > 90 ? text.slice(0, 90).trimEnd() + '…' : text) : 'Shared photos',
        link: { path: '/admin/community', queryParams: { open: p.id } },
      });
    }

    for (const r of this.data.reviews().slice(0, COMMUNITY_LIMIT)) {
      if (!r.createdAt) continue;
      events.push({
        id: `r-${r.id}`, at: r.createdAt,
        type: 'community', tone: 'accent', icon: 'star-outline',
        title: `${r.author} rated ${r.trailName} ${r.rating}★`,
        message: r.text ? (r.text.length > 90 ? r.text.slice(0, 90).trimEnd() + '…' : r.text) : 'No written review.',
        link: { path: '/admin/reviews', queryParams: { open: r.id } },
      });
    }

    return buildFeed(events, this.readState.read(), now);
  });

  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);

  constructor() {
    addIcons({
      alertCircleOutline, cardOutline, chatbubblesOutline, closeCircleOutline,
      documentAttachOutline, flagOutline, peopleOutline, personAddOutline, receiptOutline, ribbonOutline, starOutline,
    });
  }

  markRead(id: string): void {
    this.readState.mark([id]);
  }

  markAllRead(): void {
    this.readState.mark(this.notifications().map((n) => n.id));
  }
}
