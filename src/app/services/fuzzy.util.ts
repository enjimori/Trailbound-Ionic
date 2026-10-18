/**
 * Small, dependency-free fuzzy matcher for short strings such as display names.
 * Forgives typos ("jhon" → "John"), missing letters, and matches any word in a
 * name ("santos" → "Maria Santos"). Returns 0 (no match) … 1 (exact).
 */

/** Lower-case, strip accents, collapse punctuation and spaces. */
export function normalize(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Edit distance (a swapped pair of letters counts as one edit), bailing out early past `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** How well one query word matches one name word (0 … 1). */
function wordScore(q: string, w: string): number {
  if (q === w) return 1;
  if (w.startsWith(q)) return 0.9 - Math.min(0.2, (w.length - q.length) * 0.02);
  if (w.includes(q) && q.length >= 3) return 0.6;
  // Typo tolerance grows with word length: 1 edit for 4–6 letters, 2 for 7+.
  const allowed = q.length <= 3 ? 0 : q.length <= 6 ? 1 : 2;
  if (allowed) {
    // Compare against the same-length prefix too, so "jonath" still finds "Jonathan".
    const d = Math.min(
      distance(q, w, allowed),
      w.length > q.length ? distance(q, w.slice(0, q.length), allowed) : allowed + 1,
    );
    if (d <= allowed) return 0.7 - d * 0.15;
  }
  return 0;
}

/** Score a whole name against a query. Every query word must match some name word. */
export function fuzzyScore(query: string, name: string): number {
  const q = normalize(query);
  const n = normalize(name);
  if (!q || !n) return 0;
  if (n === q) return 1;
  if (n.startsWith(q)) return 0.95;

  const qWords = q.split(' ');
  const nWords = n.split(' ');
  let total = 0;
  for (const qw of qWords) {
    let best = 0;
    for (const nw of nWords) best = Math.max(best, wordScore(qw, nw));
    if (best === 0) return 0;
    total += best;
  }
  return total / qWords.length;
}

/** Filter and rank `items` by how well `getName(item)` matches `query`. */
export function fuzzyFilter<T>(items: T[], query: string, getName: (t: T) => string, limit = 50): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, getName(item)) }))
    .filter((r) => r.score >= 0.4)
    .sort((a, b) => b.score - a.score || getName(a.item).localeCompare(getName(b.item)))
    .slice(0, limit)
    .map((r) => r.item);
}
