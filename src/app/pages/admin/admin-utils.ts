/** Small formatting helpers shared by the admin screens. */

/** ₱12,345 — whole pesos, as everywhere else in the app. */
export function peso(n: number | null | undefined): string {
  return '₱' + Math.round(n ?? 0).toLocaleString('en-PH');
}

/** Compact peso for chart axes: ₱0, ₱5k, ₱12.5k. */
export function pesoShort(n: number): string {
  if (n >= 1_000_000) return '₱' + trim(n / 1_000_000) + 'M';
  if (n >= 1000) return '₱' + trim(n / 1000) + 'k';
  return '₱' + Math.round(n);
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

/** Accepts a Firestore Timestamp, an ISO string, epoch ms or a Date. */
export function toDate(v: unknown): Date | null {
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
export function dayKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** "yyyy-mm-dd" as local midnight. */
export function fromDayKey(key: string): Date {
  return new Date(key + 'T00:00:00');
}

export function timeAgo(d: Date | null): string {
  if (!d) return '—';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? 'a month ago' : `${months} months ago`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Case-insensitive "does any of these fields contain the query". */
export function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(needle));
}

/** Percentage change, or null when there is nothing to compare against. */
export function pctChange(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/** A soft, stable colour per name, for initial avatars. */
const AVATAR_TINTS = ['#e9d3b4', '#cfe0cf', '#d9dff0', '#f0d6cf', '#e4dcef', '#d6e8e6', '#efe4bf'];
export function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
