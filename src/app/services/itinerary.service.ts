/**
 * Saved itineraries — TrailBound Basic (up to 3) and Pro (unlimited, plus
 * multi-day trips, a group list and a shared group gear checklist).
 *
 * Saved on the hiker's own document as users/{uid}.itineraries, the same
 * place as the subscription, which firestore.rules already lets the owner
 * write. A copy is kept on the device in case Firestore refuses the write.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../services/firebase.client';
import { SubscriptionService } from '../services/subscription.service';
import { BASIC_ITINERARY_LIMIT } from '../models/subscription.model';
import { newId, readLocal, writeLocal } from '../premium/premium';

export interface ItineraryStop { id: string; time: string; title: string; note: string; }
export interface ItineraryDay { id: string; stops: ItineraryStop[]; }
export interface GroupMember { id: string; name: string; contact: string; role: string; }
export interface GroupGearItem { id: string; text: string; memberId: string | null; packed: boolean; }

export interface Itinerary {
  id: string;
  title: string;
  trailId: string;
  trailName: string;
  /** "yyyy-mm-dd", or '' when not decided yet. */
  date: string;
  days: ItineraryDay[];
  notes: string;
  /** Pro: who is going. */
  members: GroupMember[];
  /** Pro: shared gear, each item assigned to someone. */
  gear: GroupGearItem[];
  /** Set when it was saved from a booking. */
  bookingRef: string | null;
  createdAt: string;
  updatedAt: string;
}

const DEVICE_KEY = 'trailbound.itineraries.';

/** A sensible day on the mountain to start from. */
export function defaultDay(first = true): ItineraryDay {
  const stops: [string, string][] = first
    ? [
      ['04:30', 'Meet-up and travel to the jump-off'],
      ['06:00', 'Registration and safety briefing'],
      ['06:30', 'Start the hike'],
      ['09:30', 'Summit — photos and rest'],
      ['10:30', 'Start the descent'],
      ['13:00', 'Back at the jump-off; wash up and lunch'],
      ['15:00', 'Travel home'],
    ]
    : [
      ['05:00', 'Wake up and breakfast'],
      ['06:00', 'Break camp and start hiking'],
      ['12:00', 'Lunch on the trail'],
      ['16:00', 'Reach camp; set up and dinner'],
    ];
  return { id: newId('d'), stops: stops.map(([time, title]) => ({ id: newId('s'), time, title, note: '' })) };
}

/** Group gear most trips share out. */
export const SUGGESTED_GROUP_GEAR = [
  'Group first-aid kit', 'Tent(s)', 'Stove and fuel', 'Cook set and utensils',
  'Water filter', 'Rope / utility cord', 'Trash bags', 'Power bank for the group',
];

@Injectable({ providedIn: 'root' })
export class ItineraryService {
  private readonly subscriptions = inject(SubscriptionService);
  private readonly _list = signal<Itinerary[]>([]);
  private uid: string | null = null;

  readonly itineraries = computed(() =>
    [...this._list()].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')),
  );
  readonly count = computed(() => this._list().length);

  /** Null = unlimited (Pro / Facilitator). */
  readonly limit = computed<number | null>(() =>
    this.subscriptions.has('unlimitedItineraries') ? null : BASIC_ITINERARY_LIMIT,
  );

  /** Whether one more can be saved right now. */
  readonly canCreate = computed(() => {
    if (!this.subscriptions.has('saveItineraries')) return false;
    const max = this.limit();
    return max === null || this.count() < max;
  });

  readonly ready: Promise<void>;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      onAuthStateChanged(auth, async (user) => {
        this.uid = user?.uid ?? null;
        await this.load(this.uid);
        resolve();
      });
    });
  }

  byId(id: string): Itinerary | undefined {
    return this._list().find((i) => i.id === id);
  }

  /** Creates and saves a new itinerary. Throws if the plan does not allow it. */
  async create(init: Partial<Itinerary> & Pick<Itinerary, 'trailId' | 'trailName'>): Promise<Itinerary> {
    if (!this.canCreate()) throw new Error('Your plan does not allow another itinerary.');
    const now = new Date().toISOString();
    const it: Itinerary = {
      id: newId('it'),
      title: init.title?.trim() || `${init.trailName} hike`,
      trailId: init.trailId,
      trailName: init.trailName,
      date: init.date ?? '',
      days: init.days?.length ? init.days : [defaultDay(true)],
      notes: init.notes ?? '',
      members: init.members ?? [],
      gear: init.gear ?? [],
      bookingRef: init.bookingRef ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.save([it, ...this._list()]);
    return it;
  }

  async update(it: Itinerary): Promise<void> {
    const next = { ...it, updatedAt: new Date().toISOString() };
    await this.save(this._list().map((i) => (i.id === it.id ? next : i)));
  }

  async remove(id: string): Promise<void> {
    await this.save(this._list().filter((i) => i.id !== id));
  }

  /** Plain-text version for the share sheet (group chat, SMS…). */
  shareText(it: Itinerary): string {
    const lines = [`TrailBound itinerary — ${it.title}`, `${it.trailName}${it.date ? ' · ' + it.date : ''}`, ''];
    it.days.forEach((d, i) => {
      if (it.days.length > 1) lines.push(`Day ${i + 1}`);
      d.stops.forEach((s) => lines.push(`  ${s.time}  ${s.title}${s.note ? ' — ' + s.note : ''}`));
    });
    if (it.members.length) {
      lines.push('', 'Group:');
      it.members.forEach((m) => lines.push(`  • ${m.name}${m.role ? ' (' + m.role + ')' : ''}${m.contact ? ' — ' + m.contact : ''}`));
    }
    if (it.gear.length) {
      lines.push('', 'Group gear:');
      it.gear.forEach((g) => {
        const who = it.members.find((m) => m.id === g.memberId)?.name ?? 'unassigned';
        lines.push(`  [${g.packed ? 'x' : ' '}] ${g.text} — ${who}`);
      });
    }
    if (it.notes.trim()) lines.push('', `Notes: ${it.notes.trim()}`);
    return lines.join('\n');
  }

  // ── storage ─────────────────────────────────────────────────────────────

  private async load(uid: string | null) {
    if (!uid) {
      this._list.set([]);
      return;
    }
    let cloud: Itinerary[] | null = null;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      const raw = snap.exists() ? snap.data()['itineraries'] : null;
      cloud = Array.isArray(raw) ? (raw as Itinerary[]) : null;
    } catch (e) {
      console.warn('Could not read itineraries from Firestore; using this device\'s copy.', e);
    }
    if (this.uid !== uid) return;
    this._list.set(cloud ?? readLocal<Itinerary[]>(DEVICE_KEY + uid, []));
  }

  private async save(list: Itinerary[]) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not signed in.');
    this._list.set(list);
    writeLocal(DEVICE_KEY + uid, list);
    try {
      await setDoc(doc(db, 'users', uid), { itineraries: list }, { merge: true });
    } catch (e) {
      console.warn('Firestore refused the itinerary write; it is saved on this device only.', e);
    }
  }
}
