import { Injectable, computed, signal } from '@angular/core';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection, doc, onSnapshot, serverTimestamp, setDoc, type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase.client';
import type { Guide, HikePackage, MerchItem } from '../models/booking.model';
import { GUIDES, MERCH, PACKAGES } from '../pages/booking/booking-catalog';
import type { Trail } from '../models/trail.model';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly _addedTrails = signal<Trail[]>([]);
  private readonly _trailOverrides = signal<Record<string, Partial<Trail>>>({});
  private readonly _addedPackages = signal<HikePackage[]>([]);
  private readonly _addedMerch = signal<MerchItem[]>([]);
  private readonly _addedGuides = signal<Guide[]>([]);

  readonly addedTrails = this._addedTrails.asReadonly();
  readonly trailOverrides = this._trailOverrides.asReadonly();
  readonly packages = computed(() => [...PACKAGES, ...this._addedPackages()]);
  readonly merch = computed(() => [...MERCH, ...this._addedMerch()]);
  readonly guides = computed(() => [...GUIDES, ...this._addedGuides()]);

  private listeners: Unsubscribe[] = [];

  constructor() {
    onAuthStateChanged(auth, (user) => {
      this.listeners.forEach((unsubscribe) => unsubscribe());
      this.listeners = [];
      this._addedTrails.set([]);
      this._trailOverrides.set({});
      this._addedPackages.set([]);
      this._addedMerch.set([]);
      this._addedGuides.set([]);
      if (!user) return;

      this.listeners.push(onSnapshot(collection(db, 'catalog_trails'), (snapshot) => {
        this._addedTrails.set(snapshot.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        } as Trail)));
      }, (error) => console.error('Could not load added trails.', error)));

      this.listeners.push(onSnapshot(collection(db, 'catalog_trail_overrides'), (snapshot) => {
        this._trailOverrides.set(Object.fromEntries(snapshot.docs.map((entry) => [
          entry.id,
          entry.data() as Partial<Trail>,
        ])));
      }, (error) => console.error('Could not load trail edits.', error)));

      this.listeners.push(onSnapshot(collection(db, 'catalog_packages'), (snapshot) => {
        this._addedPackages.set(snapshot.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        } as HikePackage)));
      }, (error) => console.error('Could not load added packages.', error)));

      this.listeners.push(onSnapshot(collection(db, 'catalog_merch'), (snapshot) => {
        this._addedMerch.set(snapshot.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        } as MerchItem)));
      }, (error) => console.error('Could not load added merchandise.', error)));

      this.listeners.push(onSnapshot(collection(db, 'catalog_guides'), (snapshot) => {
        this._addedGuides.set(snapshot.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        } as Guide)));
      }, (error) => console.error('Could not load added guides.', error)));
    });
  }

  async createTrail(trail: Omit<Trail, 'id' | 'rating' | 'category' | 'status'>): Promise<void> {
    const ref = doc(collection(db, 'catalog_trails'));
    await setDoc(ref, {
      ...trail,
      category: 'Popular',
      status: 'open',
      rating: 0,
      createdAt: serverTimestamp(),
    });
  }

  withTrailOverrides<T extends Trail>(trails: readonly T[]): T[] {
    const overrides = this._trailOverrides();
    return trails.map((trail) => ({ ...trail, ...overrides[trail.id], id: trail.id }));
  }

  async updateTrail(trail: Trail): Promise<void> {
    const { id, ...details } = trail;
    await setDoc(doc(db, 'catalog_trail_overrides', id), {
      ...details,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  async createPackage(item: Omit<HikePackage, 'id' | 'includedActivities' | 'coversActivityIds'>): Promise<void> {
    const ref = doc(collection(db, 'catalog_packages'));
    await setDoc(ref, {
      ...item,
      includedActivities: 0,
      coversActivityIds: [],
      createdAt: serverTimestamp(),
    });
  }

  async createMerch(item: Omit<MerchItem, 'id'>): Promise<void> {
    const ref = doc(collection(db, 'catalog_merch'));
    await setDoc(ref, { ...item, createdAt: serverTimestamp() });
  }

  async createGuide(guide: Omit<Guide, 'id'>): Promise<void> {
    const ref = doc(collection(db, 'catalog_guides'));
    await setDoc(ref, { ...guide, createdAt: serverTimestamp() });
  }
}
