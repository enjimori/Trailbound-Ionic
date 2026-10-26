/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FACILITATOR WORKSPACE DATA — TrailBound Facilitator
 *
 * A facilitator (tour organiser) keeps their own clients and group trips:
 *   clients   name, contacts, tags, notes, and their documents
 *             (valid ID, medical certificate, waiver, training) with status
 *             and expiry
 *   trips     trail, date, capacity, price per head, the guide, which
 *             clients are going, and each client's checklist progress
 *
 * Saved on the facilitator's own document as users/{uid}.facilitator — the
 * owner may write their own document under the current firestore.rules, so
 * no rules change is needed. A device copy covers a refused write.
 *
 * CLIENT CHECKLIST (the Facilitator MLP)
 * The facilitator sends each client a link to /client-checklist. The client
 * ticks off the gear list there. When the client is signed in, their progress
 * is written to THEIR OWN public profile (profiles/{clientUid}) under
 * facilitatorChecklists, and their uid-free entry names this facilitator in
 * facilitatorUids. profiles are public-read and owner-write in the current
 * rules, so the facilitator can read the progress back with one query and no
 * rules change. Only counts are shared (items ticked, total, completed time).
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { auth, db } from '../services/firebase.client';
import { UserService } from '../services/user.service';
import { newId, readLocal, todayKey, writeLocal } from '../premium/premium';

export type DocType = 'validId' | 'medical' | 'waiver' | 'training';
export type DocStatus = 'missing' | 'submitted' | 'verified';

export const DOC_TYPES: { id: DocType; label: string; expires: boolean }[] = [
  { id: 'validId', label: 'Valid ID', expires: true },
  { id: 'medical', label: 'Medical certificate', expires: true },
  { id: 'waiver', label: 'Signed waiver', expires: false },
  { id: 'training', label: 'Basic mountaineering course', expires: false },
];

export interface ClientDoc { status: DocStatus; expires: string; }

export interface FacClient {
  id: string;
  name: string;
  phone: string;
  email: string;
  emergencyContact: string;
  notes: string;
  tags: string[];
  docs: Record<DocType, ClientDoc>;
  createdAt: string;
}

export interface ChecklistStatus {
  sentAt: string | null;
  done: number;
  total: number;
  completedAt: string | null;
  /** Marked complete by the facilitator (e.g. checked in person). */
  manual: boolean;
}

export type TripStatus = 'planned' | 'confirmed' | 'completed' | 'cancelled';

export interface FacTrip {
  id: string;
  trailId: string;
  trailName: string;
  difficulty: string;
  date: string;
  capacity: number;
  pricePerHead: number;
  guideId: string | null;
  status: TripStatus;
  clientIds: string[];
  checklist: Record<string, ChecklistStatus>;
  notes: string;
  createdAt: string;
}

export interface FacilitatorWorkspace {
  businessName: string;
  clients: FacClient[];
  trips: FacTrip[];
}

/** What a client's link writes to their own profile. */
export interface RemoteChecklist {
  f: string;
  t: string;
  c: string;
  trailId: string;
  done: number;
  total: number;
  completedAt: string | null;
  updatedAt: string;
}

const DEVICE_KEY = 'trailbound.facilitator.';
const EMPTY: FacilitatorWorkspace = { businessName: '', clients: [], trips: [] };

export function blankDocs(): Record<DocType, ClientDoc> {
  return {
    validId: { status: 'missing', expires: '' },
    medical: { status: 'missing', expires: '' },
    waiver: { status: 'missing', expires: '' },
    training: { status: 'missing', expires: '' },
  };
}

export function emptyChecklist(): ChecklistStatus {
  return { sentAt: null, done: 0, total: 0, completedAt: null, manual: false };
}

/** The key a client's progress is stored under on their profile. */
export function remoteKey(f: string, tripId: string, clientId: string): string {
  return `${f}-${tripId}-${clientId}`;
}

@Injectable({ providedIn: 'root' })
export class FacilitatorService {
  private readonly users = inject(UserService);
  private readonly _ws = signal<FacilitatorWorkspace>(EMPTY);
  private uid: string | null = null;

  readonly workspace = this._ws.asReadonly();
  readonly clients = computed(() => [...this._ws().clients].sort((a, b) => a.name.localeCompare(b.name)));
  readonly trips = computed(() => [...this._ws().trips].sort((a, b) => a.date.localeCompare(b.date)));
  readonly upcomingTrips = computed(() => this.trips().filter((t) => t.date >= todayKey() && t.status !== 'cancelled' && t.status !== 'completed'));
  readonly businessName = computed(() => this._ws().businessName || this.users.profile().name || 'Your facilitator');

  readonly ready: Promise<void>;
  readonly myUid = () => this.uid;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      onAuthStateChanged(auth, async (user) => {
        this.uid = user?.uid ?? null;
        await this.load(this.uid);
        resolve();
      });
    });
  }

  clientById(id: string): FacClient | undefined {
    return this._ws().clients.find((c) => c.id === id);
  }

  tripById(id: string): FacTrip | undefined {
    return this._ws().trips.find((t) => t.id === id);
  }

  // ── clients ─────────────────────────────────────────────────────────────

  async addClient(c: Omit<FacClient, 'id' | 'docs' | 'createdAt'>): Promise<FacClient> {
    const client: FacClient = { ...c, id: newId('c'), docs: blankDocs(), createdAt: new Date().toISOString() };
    await this.patch((ws) => ({ ...ws, clients: [...ws.clients, client] }));
    return client;
  }

  async updateClient(client: FacClient) {
    await this.patch((ws) => ({ ...ws, clients: ws.clients.map((c) => (c.id === client.id ? client : c)) }));
  }

  async removeClient(id: string) {
    await this.patch((ws) => ({
      ...ws,
      clients: ws.clients.filter((c) => c.id !== id),
      trips: ws.trips.map((t) => ({ ...t, clientIds: t.clientIds.filter((x) => x !== id) })),
    }));
  }

  // ── trips ───────────────────────────────────────────────────────────────

  async addTrip(t: Pick<FacTrip, 'trailId' | 'trailName' | 'difficulty' | 'date' | 'capacity' | 'pricePerHead' | 'guideId'>): Promise<FacTrip> {
    const trip: FacTrip = {
      ...t, id: newId('t'), status: 'planned', clientIds: [], checklist: {}, notes: '', createdAt: new Date().toISOString(),
    };
    await this.patch((ws) => ({ ...ws, trips: [...ws.trips, trip] }));
    return trip;
  }

  async updateTrip(trip: FacTrip) {
    await this.patch((ws) => ({ ...ws, trips: ws.trips.map((t) => (t.id === trip.id ? trip : t)) }));
  }

  async removeTrip(id: string) {
    await this.patch((ws) => ({ ...ws, trips: ws.trips.filter((t) => t.id !== id) }));
  }

  async setBusinessName(name: string) {
    await this.patch((ws) => ({ ...ws, businessName: name.trim().slice(0, 60) }));
  }

  /** The link a client opens to tick off their checklist. */
  checklistLink(trip: FacTrip, client: FacClient): string {
    const params = new URLSearchParams({
      f: this.uid ?? '',
      t: trip.id,
      c: client.id,
      trail: trip.trailId,
      date: trip.date,
      n: client.name.split(' ')[0] ?? '',
      by: this.businessName(),
    });
    return `${window.location.origin}/client-checklist?${params}`;
  }

  /**
   * Reads every client's progress from their public profiles and copies it
   * onto the matching trips. Returns how many entries were found.
   */
  async refreshChecklists(): Promise<number> {
    const uid = this.uid;
    if (!uid) return 0;
    const snap = await getDocs(query(collection(db, 'profiles'), where('facilitatorUids', 'array-contains', uid)));
    const found: RemoteChecklist[] = [];
    snap.forEach((d) => {
      const all = (d.data()['facilitatorChecklists'] ?? {}) as Record<string, RemoteChecklist>;
      for (const entry of Object.values(all)) if (entry?.f === uid) found.push(entry);
    });
    if (!found.length) return 0;
    await this.patch((ws) => ({
      ...ws,
      trips: ws.trips.map((trip) => {
        const mine = found.filter((e) => e.t === trip.id && trip.clientIds.includes(e.c));
        if (!mine.length) return trip;
        const checklist = { ...trip.checklist };
        for (const e of mine) {
          const prev = checklist[e.c] ?? emptyChecklist();
          checklist[e.c] = {
            ...prev,
            done: e.done,
            total: e.total,
            completedAt: prev.manual ? prev.completedAt : e.completedAt,
          };
        }
        return { ...trip, checklist };
      }),
    }));
    return found.length;
  }

  /** Sample clients and trips so the workspace can be explored. */
  async loadSample(trails: { id: string; name: string; difficulty: string }[]) {
    const names = ['Ana Cruz', 'Ben Dela Rosa', 'Carla Mendoza', 'Dino Ramos', 'Ella Santos', 'Franco Lim'];
    const clients: FacClient[] = names.map((name, i) => ({
      id: newId('c'),
      name,
      phone: `0917${String(1000000 + i * 1111).slice(0, 7)}`,
      email: `${name.split(' ')[0].toLowerCase()}@example.com`,
      emergencyContact: '',
      notes: i === 2 ? 'Vegetarian meals' : '',
      tags: i < 3 ? ['Regular'] : ['New'],
      docs: {
        validId: { status: i % 3 === 0 ? 'submitted' : 'verified', expires: '' },
        medical: { status: i === 4 ? 'missing' : 'verified', expires: '' },
        waiver: { status: i < 4 ? 'verified' : 'missing', expires: '' },
        training: { status: i < 2 ? 'verified' : 'missing', expires: '' },
      },
      createdAt: new Date().toISOString(),
    }));
    const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    const trips: FacTrip[] = trails.slice(0, 3).map((t, i) => ({
      id: newId('t'),
      trailId: t.id,
      trailName: t.name,
      difficulty: t.difficulty,
      date: inDays([9, 23, -20][i]),
      capacity: [8, 12, 10][i],
      pricePerHead: [1800, 2500, 1500][i],
      guideId: ['g1', 'g2', 'g3'][i],
      status: (['confirmed', 'planned', 'completed'] as TripStatus[])[i],
      clientIds: clients.slice(i, i + [5, 3, 6][i]).map((c) => c.id),
      checklist: {},
      notes: '',
      createdAt: new Date().toISOString(),
    }));
    await this.patch((ws) => ({ ...ws, clients: [...ws.clients, ...clients], trips: [...ws.trips, ...trips] }));
  }

  // ── storage ─────────────────────────────────────────────────────────────

  private async patch(fn: (ws: FacilitatorWorkspace) => FacilitatorWorkspace) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not signed in.');
    const next = fn(this._ws());
    this._ws.set(next);
    writeLocal(DEVICE_KEY + uid, next);
    try {
      await setDoc(doc(db, 'users', uid), { facilitator: next }, { merge: true });
    } catch (e) {
      console.warn('Firestore refused the facilitator write; it is saved on this device only.', e);
    }
  }

  private async load(uid: string | null) {
    if (!uid) {
      this._ws.set(EMPTY);
      return;
    }
    let cloud: FacilitatorWorkspace | null = null;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      cloud = (snap.exists() ? (snap.data()['facilitator'] as FacilitatorWorkspace) : null) ?? null;
    } catch (e) {
      console.warn('Could not read the facilitator workspace from Firestore; using this device\'s copy.', e);
    }
    if (this.uid !== uid) return;
    const ws = cloud ?? readLocal<FacilitatorWorkspace>(DEVICE_KEY + uid, EMPTY);
    // Older copies may lack fields added later, so fill them in.
    this._ws.set({
      businessName: ws.businessName ?? '',
      clients: (ws.clients ?? []).map((c) => ({ ...c, tags: c.tags ?? [], docs: { ...blankDocs(), ...(c.docs ?? {}) } })),
      trips: (ws.trips ?? []).map((t) => ({ ...t, clientIds: t.clientIds ?? [], checklist: t.checklist ?? {} })),
    });
  }
}
