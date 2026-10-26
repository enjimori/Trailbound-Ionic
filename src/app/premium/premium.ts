/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PREMIUM HELPERS — shared by every subscription feature
 *
 *   PremiumGate.require('trailNavigation', 'Trail navigation')
 *       For buttons. Returns true when the hiker's plan includes the feature;
 *       otherwise shows "This is part of TrailBound Basic" with a See plans
 *       button, and returns false.
 *
 *   weatherRequestFor(trail)      coordinates + summit height for Open-Meteo
 *   describeWeatherCode(code)     WMO code → "Light rain" + icon
 *   trailPool(catalog, trails)    every trail the app knows, for pickers
 *   isHighDemandTrail(trail)      the trails Pro gets priority booking on
 *   readLocal / writeLocal        localStorage that never throws
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular/standalone';

import { Feature, planFor } from '../models/subscription.model';
import { Trail } from '../models/trail.model';
import { SubscriptionService } from '../services/subscription.service';
import { CatalogService } from '../services/catalog.service';
import { TrailService } from '../services/trail.service';
import { TRAILS_30 } from '../pages/explore/explore-trails.data';
import { geoFor } from '../pages/explore/trail-geo';
import { allTrails } from '../pages/explore/trail-lookup';
import { ForecastRequest } from '../pages/explore/trail-weather.service';

// ── Locks ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class PremiumGate {
  private readonly subscriptions = inject(SubscriptionService);
  private readonly alertCtrl = inject(AlertController);
  private readonly router = inject(Router);

  /** True if unlocked. Otherwise explains which plan unlocks it. */
  async require(feature: Feature, what: string): Promise<boolean> {
    await this.subscriptions.ready;
    if (this.subscriptions.has(feature)) return true;
    const plan = planFor(feature);
    const alert = await this.alertCtrl.create({
      header: `${what} is locked`,
      message: `It's part of ${plan.name} (₱${plan.pricePerMonth}/month). Subscribe to unlock it.`,
      buttons: [
        { text: 'Not now', role: 'cancel' },
        { text: 'See plans', handler: () => { void this.router.navigate(['/subscription']); } },
      ],
    });
    await alert.present();
    return false;
  }
}

// ── Trails ─────────────────────────────────────────────────────────────────

/** "2,926 m" → 2926. Undefined rather than 0, which would mean sea level. */
export function parseMetres(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const n = Number(String(text).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

/** Every trail the app knows (the 30 Luzon trails + admin-added ones). */
export function trailPool(catalog: CatalogService, trails: TrailService): Trail[] {
  const seen = new Set<string>();
  return [...catalog.withTrailOverrides(allTrails()), ...trails.addedTrails()].filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

/** One trail by id from any source, with admin overrides applied. */
export function findTrail(id: string, catalog: CatalogService, trails: TrailService): Trail | undefined {
  const found = trails.getById(id) ?? TRAILS_30.find((t) => t.id === id);
  return found ? catalog.withTrailOverrides([found])[0] : undefined;
}

/** What the weather services need for a trail, or null with no coordinates. */
export function weatherRequestFor(trail: Trail | undefined): ForecastRequest | null {
  if (!trail) return null;
  const geo = geoFor(trail.id, trail);
  if (!geo) return null;
  const dataset = TRAILS_30.find((t) => t.id === trail.id);
  return {
    id: trail.id,
    lat: geo.lat,
    lng: geo.lng,
    elevationM: parseMetres(trail.elevation),
    trailType: dataset?.trailType,
  };
}

/**
 * High-demand trails: the ones marked Popular (Pulag, Batulao, Pinatubo,
 * Pico de Loro, Maculot, Pamitinan, Daraitan…). Pro bookings on these go to
 * the front of the review queue.
 */
export function isHighDemandTrail(trail: Pick<Trail, 'id' | 'category'> | undefined): boolean {
  if (!trail) return false;
  const dataset = TRAILS_30.find((t) => t.id === trail.id);
  return (dataset?.category ?? trail.category) === 'Popular';
}

// ── Weather codes (WMO, as Open-Meteo reports them) ────────────────────────

export function describeWeatherCode(code: number): { summary: string; icon: string } {
  if (code === 0) return { summary: 'Clear sky', icon: 'sunny-outline' };
  if (code === 1 || code === 2) return { summary: code === 1 ? 'Mainly clear' : 'Partly cloudy', icon: 'partly-sunny-outline' };
  if (code === 3) return { summary: 'Overcast', icon: 'cloudy-outline' };
  if (code === 45 || code === 48) return { summary: 'Fog', icon: 'cloudy-outline' };
  if (code >= 51 && code <= 57) return { summary: 'Drizzle', icon: 'rainy-outline' };
  if (code === 61 || code === 80) return { summary: 'Light rain', icon: 'rainy-outline' };
  if (code === 63 || code === 81) return { summary: 'Rain', icon: 'rainy-outline' };
  if (code === 65 || code === 82) return { summary: 'Heavy rain', icon: 'rainy-outline' };
  if (code >= 95) return { summary: 'Thunderstorms', icon: 'thunderstorm-outline' };
  return { summary: 'Mixed conditions', icon: 'cloudy-outline' };
}

// ── Dates ──────────────────────────────────────────────────────────────────

/** Today as "yyyy-mm-dd" in local time. */
export function todayKey(): string {
  return dateKey(new Date());
}

export function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days from today to a "yyyy-mm-dd" date (negative = past). */
export function daysUntil(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  const target = new Date(y, (m || 1) - 1, d || 1).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

// ── Device storage ─────────────────────────────────────────────────────────

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable — the value lasts until the page closes.
  }
}

/** Short random id for items the hiker creates. */
export function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
