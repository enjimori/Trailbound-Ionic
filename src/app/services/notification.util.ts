/**
 * Shared pieces for every notification feed — hiker, admin, guide and permit
 * office. Each feed is built from live Firestore data that role is already
 * allowed to read, so there is nothing extra to store and firestore.rules
 * does not change. Which notifications have been read is remembered on this
 * device, per account and per feed.
 */
import { signal } from '@angular/core';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase.client';
import type { AppNotification, NotificationTone, NotificationType } from '../models/notification.model';

/** How far back a feed looks. */
export const NOTIFICATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Most notifications a feed shows. */
export const NOTIFICATION_LIMIT = 40;

/** Hex fallbacks for templates that colour by iconColor rather than tone. */
const TONE_HEX: Record<NotificationTone, string> = {
  accent: '#E8D99C',
  success: '#4F8B57',
  warning: '#F2C14E',
  danger: '#F0505A',
  info: '#8FB3D9',
};

/** What a feed hands to note() — everything except the derived fields. */
export interface NoteInput {
  id: string;
  at: Date | null;
  type: NotificationType;
  tone: NotificationTone;
  icon: string;
  title: string;
  message: string;
  link?: AppNotification['link'];
}

/**
 * Turns feed events into the list a screen shows: drops anything with no time
 * or older than the window, marks read ones, sorts newest first and caps it.
 */
export function buildFeed(events: NoteInput[], read: Set<string>, now = Date.now()): AppNotification[] {
  const cutoff = now - NOTIFICATION_WINDOW_MS;
  const seen = new Set<string>();
  const out: AppNotification[] = [];
  for (const e of events) {
    const ms = e.at?.getTime();
    if (!ms || ms < cutoff || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({
      id: e.id,
      type: e.type,
      tone: e.tone,
      icon: e.icon,
      iconColor: TONE_HEX[e.tone],
      title: e.title,
      message: e.message,
      link: e.link,
      createdAt: ms,
      time: relativeTime(ms, now),
      read: read.has(e.id),
    });
  }
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, NOTIFICATION_LIMIT);
}

/** "just now", "5m ago", "3h ago", "yesterday", "4 days ago". */
export function relativeTime(ms: number, now = Date.now()): string {
  const mins = Math.floor((now - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return 'a month ago';
}

/** Accepts a Firestore Timestamp, an ISO string, epoch ms or a Date. */
export function asDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Local calendar day as yyyy-mm-dd. */
export function todayKey(d = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Whole days from today to a yyyy-mm-dd hike date (0 = today, 1 = tomorrow). */
export function daysUntil(dayKey: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const hike = new Date(dayKey + 'T00:00:00').getTime();
  const today = new Date(todayKey(now) + 'T00:00:00').getTime();
  return Math.round((hike - today) / 86_400_000);
}

/** Local midnight at the start of today. Used as the time of day-based reminders. */
export function startOfToday(now = new Date()): Date {
  return new Date(todayKey(now) + 'T00:00:00');
}

/** "Oct 30" from yyyy-mm-dd, or the input unchanged when it is not a date. */
export function shortDay(dayKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return dayKey;
  return new Date(dayKey + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

/** "Oct 30" from any date value. */
export function shortDate(d: Date | null): string {
  return d ? d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '';
}

/**
 * Which notifications this account has read, remembered on this device.
 * Follows the shared Firebase session on its own, so a feed never shows one
 * account's read marks to another account on the same phone.
 */
export class NotificationReadState {
  private readonly _read = signal<Set<string>>(new Set());
  readonly read = this._read.asReadonly();
  private uid: string | null = null;

  constructor(private readonly scope: string, private readonly max = 400) {
    onAuthStateChanged(auth, (user) => {
      this.uid = user?.uid ?? null;
      this._read.set(this.uid ? this.load(this.uid) : new Set());
    });
  }

  /** Marks these ids as read. */
  mark(ids: string[]): void {
    if (!this.uid || !ids.length) return;
    const next = new Set(this._read());
    let changed = false;
    for (const id of ids) {
      if (!next.has(id)) {
        next.add(id);
        changed = true;
      }
    }
    if (!changed) return;
    const kept = [...next].slice(-this.max);
    this._read.set(new Set(kept));
    try {
      localStorage.setItem(this.key(this.uid), JSON.stringify(kept));
    } catch {
      /* storage full or blocked: still works for this session */
    }
  }

  private key(uid: string): string {
    return `${this.scope}.${uid}`;
  }

  private load(uid: string): Set<string> {
    try {
      const raw = localStorage.getItem(this.key(uid));
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }
}

/**
 * A signal that ticks every minute, so "5m ago" labels and day-based
 * reminders (today / tomorrow) stay current while the app is open.
 */
export function minuteClock() {
  const now = signal(Date.now());
  setInterval(() => now.set(Date.now()), 60_000);
  return now.asReadonly();
}
