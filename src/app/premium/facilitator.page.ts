/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FACILITATOR WORKSPACE — TrailBound Facilitator   (/facilitator)
 *
 *   Overview   booking dashboard: key numbers, what needs attention, next
 *              trips, and the facilitator's own TrailBound bookings
 *   Trips      capacity management, guide scheduling (availability and
 *              double-booking checks) and the client checklist (MLP): send
 *              each client their checklist and see who has completed it
 *   Clients    customer management and digital document tracking
 *              (valid ID, medical certificate, waiver, training + expiry)
 *   Analytics  trips, clients, revenue, capacity use, readiness
 *
 * Without the Facilitator plan the page shows what it does and an unlock
 * button. Data: FacilitatorService (users/{uid}.facilitator).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AlertController, IonContent, IonIcon, IonLabel, IonSegment, IonSegmentButton, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline, alertCircleOutline, arrowBackOutline, barChartOutline, briefcaseOutline, calendarOutline,
  checkmarkCircle, chevronDownOutline, documentTextOutline, peopleOutline, personAddOutline,
  refreshOutline, sendOutline, trashOutline,
} from 'ionicons/icons';

import { Difficulty, Trail } from '../models/trail.model';
import { SubscriptionService } from '../services/subscription.service';
import { CatalogService } from '../services/catalog.service';
import { TrailService } from '../services/trail.service';
import { BookingService } from '../services/booking.service';
import { GuideStatusService } from '../services/guide-status.service';
import { gearFor } from './prepare-hike.component';
import { LockedFeatureComponent } from './locked-feature.component';
import {
  ChecklistStatus, DOC_TYPES, DocStatus, DocType, FacClient, FacTrip, FacilitatorService, TripStatus, emptyChecklist,
} from './facilitator.service';
import { daysUntil, todayKey, trailPool } from './premium';

type Tab = 'overview' | 'trips' | 'clients' | 'analytics';

interface Attention { level: 'warn' | 'info'; text: string; }
interface Bar { label: string; value: number; display: string; }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Component({
  selector: 'app-facilitator',
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonIcon, IonSegment, IonSegmentButton, IonLabel, LockedFeatureComponent],
  templateUrl: './facilitator.page.html',
  styleUrls: ['./facilitator.page.scss'],
})
export class FacilitatorPage {
  private readonly subscriptions = inject(SubscriptionService);
  private readonly fac = inject(FacilitatorService);
  private readonly bookings = inject(BookingService);
  private readonly guideStatus = inject(GuideStatusService);
  private readonly catalog = inject(CatalogService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly unlocked = computed(() => this.subscriptions.has('facilitatorTools'));
  readonly tab = signal<Tab>('overview');
  readonly today = todayKey();

  readonly trailOptions: Trail[] = trailPool(this.catalog, inject(TrailService)).sort((a, b) => a.name.localeCompare(b.name));
  readonly guides = this.catalog.guides;
  readonly docTypes = DOC_TYPES;

  readonly clients = this.fac.clients;
  readonly trips = this.fac.trips;
  readonly upcomingTrips = this.fac.upcomingTrips;
  readonly businessName = this.fac.businessName;
  readonly savedName = computed(() => this.fac.workspace().businessName);
  businessDraft = '';

  readonly openTripId = signal<string | null>(null);
  readonly openClientId = signal<string | null>(null);
  readonly clientQuery = signal('');
  readonly refreshing = signal(false);

  // New trip form
  readonly addingTrip = signal(false);
  newTrip = { trailId: '', date: '', capacity: 12, pricePerHead: 2000, guideId: '' };

  // New client form
  readonly addingClient = signal(false);
  newClient = { name: '', phone: '', email: '', emergencyContact: '', tags: '', notes: '' };

  /** Picker value per trip for "add a client". */
  addPick: Record<string, string> = {};

  // ── Overview numbers ────────────────────────────────────────────────────

  readonly seats = computed(() => {
    const up = this.upcomingTrips();
    const filled = up.reduce((s, t) => s + t.clientIds.length, 0);
    const cap = up.reduce((s, t) => s + t.capacity, 0);
    return { filled, cap, pct: cap ? Math.round((filled / cap) * 100) : 0 };
  });

  readonly readiness = computed(() => {
    let ready = 0;
    let total = 0;
    for (const t of this.upcomingTrips()) {
      for (const id of t.clientIds) {
        total++;
        if (t.checklist[id]?.completedAt) ready++;
      }
    }
    return { ready, total, pct: total ? Math.round((ready / total) * 100) : 0 };
  });

  readonly docCompliance = computed(() => {
    const cs = this.clients();
    const all = cs.length * DOC_TYPES.length;
    const ok = cs.reduce((s, c) => s + DOC_TYPES.filter((d) => this.docOk(c, d.id)).length, 0);
    return all ? Math.round((ok / all) * 100) : 0;
  });

  readonly expectedRevenue = computed(() =>
    this.upcomingTrips().reduce((s, t) => s + t.pricePerHead * t.clientIds.length, 0),
  );

  readonly myBookings = computed(() => {
    const up = this.bookings.bookings().filter((b) => b.date >= this.today && b.status !== 'cancelled');
    return {
      list: [...up].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3),
      pending: up.filter((b) => b.status === 'pending').length,
      confirmed: up.filter((b) => b.status === 'confirmed').length,
    };
  });

  readonly attention = computed<Attention[]>(() => {
    const out: Attention[] = [];
    const active = this.upcomingTrips();
    for (const t of active) {
      const when = `${t.trailName}, ${this.shortDate(t.date)}`;
      if (!t.clientIds.length) out.push({ level: 'info', text: `${when}: no clients yet.` });
      const g = this.guideProblem(t);
      if (g) out.push({ level: 'warn', text: `${when}: ${g}` });
      for (const id of t.clientIds) {
        const c = this.fac.clientById(id);
        if (!c) continue;
        const missing = DOC_TYPES.filter((d) => d.id !== 'training' && !this.docOk(c, d.id, t.date)).map((d) => d.label);
        if (missing.length) out.push({ level: 'warn', text: `${c.name}: ${missing.join(', ')} not verified — ${when}.` });
        const days = daysUntil(t.date);
        if (days <= 3 && !t.checklist[id]?.completedAt) {
          out.push({ level: 'warn', text: `${c.name} hasn't finished the checklist — ${when} (${days <= 0 ? 'today' : 'in ' + days + ' day' + (days === 1 ? '' : 's')}).` });
        }
      }
    }
    return out.slice(0, 12);
  });

  readonly filteredClients = computed(() => {
    const q = this.clientQuery().trim().toLowerCase();
    return this.clients().filter((c) => !q || [c.name, c.email, c.phone, c.tags.join(' ')].join(' ').toLowerCase().includes(q));
  });

  // ── Analytics ───────────────────────────────────────────────────────────

  readonly analytics = computed(() => {
    const trips = this.trips().filter((t) => t.status !== 'cancelled');
    const people = trips.reduce((s, t) => s + t.clientIds.length, 0);
    const cap = trips.reduce((s, t) => s + t.capacity, 0);
    const revenue = trips.reduce((s, t) => s + t.pricePerHead * t.clientIds.length, 0);
    const served = new Set(trips.filter((t) => t.status === 'completed' || t.status === 'confirmed').flatMap((t) => t.clientIds)).size;

    // Six months back to three ahead.
    const now = new Date();
    const months: { key: string; label: string }[] = [];
    for (let i = -5; i <= 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS[d.getMonth()] });
    }
    const inMonth = (key: string) => trips.filter((t) => t.date.startsWith(key));
    const clientsByMonth: Bar[] = months.map((m) => {
      const v = inMonth(m.key).reduce((s, t) => s + t.clientIds.length, 0);
      return { label: m.label, value: v, display: String(v) };
    });
    const revenueByMonth: Bar[] = months.map((m) => {
      const v = inMonth(m.key).reduce((s, t) => s + t.pricePerHead * t.clientIds.length, 0);
      return { label: m.label, value: v, display: v >= 1000 ? `₱${Math.round(v / 1000)}k` : `₱${v}` };
    });

    const byTrail = new Map<string, number>();
    trips.forEach((t) => byTrail.set(t.trailName, (byTrail.get(t.trailName) ?? 0) + t.clientIds.length));
    const topTrails: Bar[] = [...byTrail.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([label, value]) => ({ label, value, display: `${value} hikers` }));

    let checklistDone = 0;
    let checklistAll = 0;
    trips.forEach((t) => t.clientIds.forEach((id) => { checklistAll++; if (t.checklist[id]?.completedAt) checklistDone++; }));

    return {
      trips: trips.length,
      served,
      avgGroup: trips.length ? Math.round((people / trips.length) * 10) / 10 : 0,
      utilisation: cap ? Math.round((people / cap) * 100) : 0,
      revenue,
      checklistRate: checklistAll ? Math.round((checklistDone / checklistAll) * 100) : 0,
      clientsByMonth,
      revenueByMonth,
      topTrails,
      maxClients: Math.max(1, ...clientsByMonth.map((b) => b.value)),
      maxRevenue: Math.max(1, ...revenueByMonth.map((b) => b.value)),
      maxTrail: Math.max(1, ...topTrails.map((b) => b.value)),
    };
  });

  constructor() {
    addIcons({
      addOutline, alertCircleOutline, arrowBackOutline, barChartOutline, briefcaseOutline, calendarOutline,
      checkmarkCircle, chevronDownOutline, documentTextOutline, peopleOutline, personAddOutline,
      refreshOutline, sendOutline, trashOutline,
    });
    void this.fac.ready.then(() => {
      this.businessDraft = this.fac.workspace().businessName;
      if (this.unlocked()) void this.refresh(true);
    });
  }

  goBack() {
    if (window.history.length > 1) this.location.back();
    else void this.router.navigate(['/tabs/profile']);
  }

  go(url: string) {
    void this.router.navigateByUrl(url);
  }

  setTab(value: unknown) {
    if (value === 'overview' || value === 'trips' || value === 'clients' || value === 'analytics') this.tab.set(value);
  }

  // ── helpers for the template ────────────────────────────────────────────

  shortDate(key: string): string {
    const [y, m, d] = key.split('-').map(Number);
    return y ? `${MONTHS[m - 1]} ${d}` : '—';
  }

  clientName(id: string): string {
    return this.fac.clientById(id)?.name ?? 'Removed client';
  }

  guideName(id: string | null): string {
    return this.guides().find((g) => g.id === id)?.name ?? 'No guide yet';
  }

  /** Guides that may lead this trail, with availability in the label. */
  guidesFor(trailId: string) {
    return this.guides()
      .filter((g) => !trailId || this.guideStatus.canLead(g.id, trailId))
      .map((g) => {
        const s = this.guideStatus.statusFor(g.id);
        return { id: g.id, label: `${g.name}${s.available ? '' : ' (unavailable)'}${s.maxGuests ? ' · max ' + s.maxGuests : ''}` };
      });
  }

  guideProblem(t: FacTrip): string | null {
    if (!t.guideId) return 'no guide assigned.';
    const s = this.guideStatus.statusFor(t.guideId);
    const name = this.guideName(t.guideId);
    if (!s.available) return `${name} is marked unavailable.`;
    if (s.maxGuests && t.clientIds.length > s.maxGuests) return `${name} takes at most ${s.maxGuests} hikers; ${t.clientIds.length} are booked.`;
    const clash = this.trips().find((o) => o.id !== t.id && o.guideId === t.guideId && o.date === t.date && o.status !== 'cancelled');
    if (clash) return `${name} is also scheduled for ${clash.trailName} that day.`;
    return null;
  }

  pickableClients(t: FacTrip): FacClient[] {
    return this.clients().filter((c) => !t.clientIds.includes(c.id));
  }

  docOk(c: FacClient, type: DocType, byDate = this.today): boolean {
    const d = c.docs[type];
    if (!d || d.status !== 'verified') return false;
    return !d.expires || d.expires >= byDate;
  }

  verifiedCount(c: FacClient): number {
    return DOC_TYPES.filter((d) => this.docOk(c, d.id)).length;
  }

  expired(c: FacClient, type: DocType): boolean {
    const d = c.docs[type];
    return !!d?.expires && d.expires < this.today;
  }

  checklistOf(t: FacTrip, clientId: string): ChecklistStatus {
    return t.checklist[clientId] ?? emptyChecklist();
  }

  checklistText(t: FacTrip, clientId: string): string {
    const s = this.checklistOf(t, clientId);
    if (s.completedAt) return s.manual ? 'Ready (marked by you)' : 'Ready ✓';
    if (s.done > 0) return `${s.done} of ${s.total} packed`;
    if (s.sentAt) return 'Sent · not started';
    return 'Not sent';
  }

  tripsFor(c: FacClient): FacTrip[] {
    return this.trips().filter((t) => t.clientIds.includes(c.id));
  }

  pct(n: number, max: number): number {
    return max ? Math.min(100, (n / max) * 100) : 0;
  }

  // ── workspace ───────────────────────────────────────────────────────────

  async saveBusinessName() {
    if (this.businessDraft.trim() === this.fac.workspace().businessName) return;
    await this.fac.setBusinessName(this.businessDraft);
    void this.toast('Business name saved.');
  }

  async loadSample() {
    const picks = this.trailOptions.filter((t) => ['Easy', 'Moderate', 'Hard'].includes(t.difficulty)).slice(0, 3);
    await this.fac.loadSample(picks.map((t) => ({ id: t.id, name: t.name, difficulty: t.difficulty })));
    void this.toast('Sample clients and trips added.');
  }

  async refresh(quiet = false) {
    this.refreshing.set(true);
    try {
      const n = await this.fac.refreshChecklists();
      if (!quiet) void this.toast(n ? 'Checklist progress updated.' : 'No new checklist progress from clients yet.');
    } catch (e) {
      console.warn('Could not read client checklist progress.', e);
      if (!quiet) void this.toast('Could not reach TrailBound to check progress.');
    } finally {
      this.refreshing.set(false);
    }
  }

  // ── trips ───────────────────────────────────────────────────────────────

  async createTrip() {
    const trail = this.trailOptions.find((t) => t.id === this.newTrip.trailId);
    if (!trail || !this.newTrip.date) return;
    const trip = await this.fac.addTrip({
      trailId: trail.id,
      trailName: trail.name,
      difficulty: trail.difficulty,
      date: this.newTrip.date,
      capacity: Math.min(30, Math.max(1, Math.round(Number(this.newTrip.capacity) || 1))),
      pricePerHead: Math.max(0, Math.round(Number(this.newTrip.pricePerHead) || 0)),
      guideId: this.newTrip.guideId || null,
    });
    this.addingTrip.set(false);
    this.newTrip = { trailId: '', date: '', capacity: 12, pricePerHead: 2000, guideId: '' };
    this.openTripId.set(trip.id);
  }

  toggleTrip(id: string) {
    this.openTripId.update((cur) => (cur === id ? null : id));
  }

  async setTripField(t: FacTrip, patch: Partial<FacTrip>) {
    await this.fac.updateTrip({ ...t, ...patch });
  }

  async changeCapacity(t: FacTrip, delta: number) {
    const next = Math.min(30, Math.max(Math.max(1, t.clientIds.length), t.capacity + delta));
    if (next !== t.capacity) await this.fac.updateTrip({ ...t, capacity: next });
  }

  async addClientToTrip(t: FacTrip) {
    const id = this.addPick[t.id];
    if (!id) return;
    if (t.clientIds.length >= t.capacity) {
      void this.toast('This trip is full. Raise the capacity first.');
      return;
    }
    await this.fac.updateTrip({ ...t, clientIds: [...t.clientIds, id] });
    this.addPick[t.id] = '';
  }

  async removeClientFromTrip(t: FacTrip, id: string) {
    const checklist = { ...t.checklist };
    delete checklist[id];
    await this.fac.updateTrip({ ...t, clientIds: t.clientIds.filter((x) => x !== id), checklist });
  }

  /** Client checklist (MLP): share the link and mark it sent. */
  async sendChecklist(t: FacTrip, clientId: string) {
    const c = this.fac.clientById(clientId);
    if (!c) return;
    const link = this.fac.checklistLink(t, c);
    const text = `Hi ${c.name.split(' ')[0]}! Here's your gear checklist for ${t.trailName} on ${this.shortDate(t.date)}. Tick items off as you pack: ${link}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    try {
      if (nav.share) await nav.share({ title: 'Your hike checklist', text });
      else {
        await navigator.clipboard.writeText(text);
        void this.toast(`Checklist link for ${c.name} copied. Paste it in a message.`);
      }
    } catch {
      return; // Share sheet closed: not sent.
    }
    const total = gearFor((t.difficulty || 'Moderate') as Difficulty).length;
    const prev = this.checklistOf(t, clientId);
    await this.fac.updateTrip({ ...t, checklist: { ...t.checklist, [clientId]: { ...prev, sentAt: new Date().toISOString(), total: prev.total || total } } });
  }

  async markReady(t: FacTrip, clientId: string) {
    const prev = this.checklistOf(t, clientId);
    const total = prev.total || gearFor((t.difficulty || 'Moderate') as Difficulty).length;
    const next: ChecklistStatus = prev.completedAt
      ? { ...prev, completedAt: null, manual: false }
      : { ...prev, done: total, total, completedAt: new Date().toISOString(), manual: true };
    await this.fac.updateTrip({ ...t, checklist: { ...t.checklist, [clientId]: next } });
  }

  bookOnTrailBound(t: FacTrip) {
    void this.router.navigate(['/booking', t.trailId]);
  }

  async deleteTrip(t: FacTrip) {
    if (await this.confirm('Delete trip?', `${t.trailName} on ${this.shortDate(t.date)} will be removed.`)) {
      await this.fac.removeTrip(t.id);
    }
  }

  // ── clients ─────────────────────────────────────────────────────────────

  async createClient() {
    const name = this.newClient.name.trim();
    if (!name) return;
    const c = await this.fac.addClient({
      name: name.slice(0, 60),
      phone: this.newClient.phone.trim().slice(0, 20),
      email: this.newClient.email.trim().slice(0, 80),
      emergencyContact: this.newClient.emergencyContact.trim().slice(0, 80),
      notes: this.newClient.notes.trim().slice(0, 400),
      tags: this.newClient.tags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5),
    });
    this.addingClient.set(false);
    this.newClient = { name: '', phone: '', email: '', emergencyContact: '', tags: '', notes: '' };
    this.openClientId.set(c.id);
  }

  toggleClient(id: string) {
    this.openClientId.update((cur) => (cur === id ? null : id));
  }

  async setDoc(c: FacClient, type: DocType, patch: { status?: DocStatus; expires?: string }) {
    await this.fac.updateClient({ ...c, docs: { ...c.docs, [type]: { ...c.docs[type], ...patch } } });
  }

  async saveClientNotes(c: FacClient, notes: string) {
    if (notes !== c.notes) await this.fac.updateClient({ ...c, notes: notes.slice(0, 400) });
  }

  async deleteClient(c: FacClient) {
    if (await this.confirm('Delete client?', `${c.name} will be removed from your clients and trips.`)) {
      await this.fac.removeClient(c.id);
    }
  }

  // ── misc ────────────────────────────────────────────────────────────────

  readonly statuses: TripStatus[] = ['planned', 'confirmed', 'completed', 'cancelled'];

  private async confirm(header: string, message: string): Promise<boolean> {
    const alert = await this.alertCtrl.create({
      header, message,
      buttons: [{ text: 'Keep', role: 'cancel' }, { text: 'Delete', role: 'destructive' }],
    });
    await alert.present();
    return (await alert.onDidDismiss()).role === 'destructive';
  }

  private async toast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'top', color: 'dark' });
    await t.present();
  }
}
