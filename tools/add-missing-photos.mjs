#!/usr/bin/env node
/**
 * add-missing-photos.mjs — one-off helper, NOT shipped with the app.
 *
 * Fills in a photo for every trail that still shows the placeholder art.
 * Trails that already have a photo are left exactly as they are.
 *
 * What it does:
 *   1. Looks up each missing mountain on Wikimedia Commons (free-licence photos).
 *   2. Downloads the chosen photo into src/assets/trails/  (e.g. T001.jpg).
 *   3. ADDS an entry for it to the TRAIL_PHOTOS list in
 *      src/app/pages/explore/trail-photos.ts, with the photographer credit and
 *      licence. Existing entries and the functions in that file are untouched.
 *
 * Only photos whose Commons title or description actually names the mountain
 * are used. If none qualifies, that trail keeps its placeholder.
 *
 * USAGE (run from the project folder, the one with ionic.config.json):
 *   node tools/add-missing-photos.mjs              # add photos
 *   node tools/add-missing-photos.mjs --dry        # only list what it would pick
 *   node tools/add-missing-photos.mjs --pick=T009:2,T016:3
 *       # swap a photo you don't like for the 2nd / 3rd candidate
 *
 * Needs Node 18+ (built-in fetch). No dependencies.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ASSET_DIR = join('src', 'assets', 'trails');
const PHOTOS_FILE = join('src', 'app', 'pages', 'explore', 'trail-photos.ts');
const API = process.env.TB_COMMONS_API || 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'TrailBound-photo-helper/1.0 (student project)';

/**
 * The trails that had no photo. `key` must appear in the file's title or
 * description, so a search for "Mount Labo" can't return a church in Labo town
 * that happens to be tagged nearby. `pin` is a known-good Commons file tried
 * first (taken from the mountain's own Wikipedia article).
 */
const MISSING = {
  T001: { q: ['Mount Pulag'], key: /pulag/i, pin: 'Panoramic Shot of Mt. Pulag Summit and Grassland.jpg' },
  T005: { q: ['Tarak Ridge Mariveles'], key: /tarak|mariveles/i, pin: 'Tarak Ridge campsite, Mount Mariveles.jpg' },
  T008: { q: ['Mount Tapulao'], key: /tapulao/i },
  T009: { q: ['Balingkilat'], key: /balingkilat/i },
  T011: { q: ['Mount Manabu'], key: /manabu/i },
  T012: { q: ['Daguldol'], key: /daguldol/i },
  T015: { q: ['Hapunang Banoi', 'Banoi Rodriguez'], key: /banoi|hapunang/i },
  T016: { q: ['Mount Daraitan'], key: /daraitan/i },
  T017: { q: ['Mount Kulis', 'Kulis Tanay'], key: /\b(mount|mt\.?) kulis\b/i },
  T018: { q: ['Batolusong'], key: /batolusong/i },
  T020: { q: ['Kalisungan'], key: /kalisungan/i },
  T024: { q: ['Gulugod Baboy'], key: /gulugod/i },
  T026: { q: ['Pigingan'], key: /pigingan/i },
  T027: { q: ['Yangbew', 'Mount Jumbo La Trinidad'], key: /yangbew|\b(mount|mt\.?) jumbo\b/i },
  T028: { q: ['Mount Damas', 'Mt. Damas Tarlac'], key: /\b(mount|mt\.?) damas\b/i },
  T029: { q: ['Mount Labo', 'Mt. Labo'], key: /\b(mount|mt\.?) labo\b/i },
};

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }),
);
const DRY = !!args.dry;
const PICKS = {};
if (typeof args.pick === 'string') {
  for (const part of args.pick.split(',')) {
    const [id, n] = part.split(':');
    PICKS[id.trim().toUpperCase()] = Math.max(1, Number(n) || 1);
  }
}

if (!existsSync(PHOTOS_FILE)) {
  console.error(`Can't find ${PHOTOS_FILE}. Run this from the project folder (the one with ionic.config.json).`);
  process.exit(1);
}

// ── Commons ────────────────────────────────────────────────────────────────

function plain(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Obvious non-photographs. */
function unusable(title) {
  return /\.(svg|pdf|tiff?|ogv|webm|gif)$/i.test(title) ||
    /\b(map|relief|diagram|logo|seal|chart|poster|sign|signage|plaque|marker|coat of arms|location)\b/i.test(title);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * fetch() that waits and retries when Commons says "slow down" (429) or is
 * briefly unavailable (503), instead of giving up on the rest of the trails.
 */
async function politeFetch(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if ((res.status === 429 || res.status === 503) && attempt <= 5) {
      const wait = Math.max(Number(res.headers.get('retry-after')) || 0, 10 * attempt);
      console.log(`      Commons asked us to slow down, waiting ${wait}s...`);
      await sleep(wait * 1000);
      continue;
    }
    return res;
  }
}

async function api(params) {
  const url = new URL(API);
  url.search = new URLSearchParams({ format: 'json', origin: '*', ...params }).toString();
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`Commons returned ${res.status}`);
  return res.json();
}

function toCandidate(page) {
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  return {
    title: page.title.replace(/^File:/, ''),
    thumb: info.thumburl || info.url,
    width: info.width,
    height: info.height,
    description: plain(meta.ImageDescription?.value),
    // Commons categories, e.g. "Mount Batolusong" — photos of small peaks are
    // often named DSC_0123.jpg and only tagged by category.
    categories: (page.categories ?? []).map(c => c.title.replace(/^Category:/, '')).join(' | '),
    credit: plain(meta.Artist?.value) || 'Unknown',
    license: plain(meta.LicenseShortName?.value) || 'see source',
    source: info.descriptionurl,
  };
}

const IMAGEINFO = {
  prop: 'imageinfo|categories',
  iiprop: 'url|extmetadata|size',
  iiurlwidth: '1280',
  clshow: '!hidden',
  cllimit: 'max',
};

async function pinned(fileName) {
  const data = await api({ action: 'query', titles: `File:${fileName}`, ...IMAGEINFO });
  const page = Object.values(data?.query?.pages ?? {})[0];
  return toCandidate(page);
}

async function search(query) {
  const data = await api({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '12',
    ...IMAGEINFO,
  });
  const pages = Object.values(data?.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.map(toCandidate).filter(Boolean);
}

/** Usable, big enough, and its title, description or category names the mountain. */
function qualifies(c, key) {
  return c &&
    !unusable(c.title) &&
    c.width >= 500 &&
    (key.test(c.title) || key.test(c.description) || key.test(c.categories));
}

async function candidatesFor(spec) {
  const list = [];
  if (spec.pin) {
    try {
      const p = await pinned(spec.pin);
      if (qualifies(p, spec.key)) list.push(p);
    } catch { /* fall through to search */ }
  }
  for (const q of spec.q) {
    for (const c of await search(q)) {
      if (qualifies(c, spec.key) && !list.some(x => x.title === c.title)) list.push(c);
    }
    await sleep(800);
  }
  // Landscape photos first: they crop far better into the wide banners.
  return list.sort((a, b) => (b.width >= b.height) - (a.width >= a.height));
}

async function download(url, dest) {
  const res = await politeFetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

// ── trail-photos.ts (data only) ────────────────────────────────────────────

const original = readFileSync(PHOTOS_FILE, 'utf8');
const EOL = original.includes('\r\n') ? '\r\n' : '\n';
let text = original.replace(/\r\n/g, '\n');

const START = 'export const TRAIL_PHOTOS: Record<string, TrailPhoto> = {';
const startAt = text.indexOf(START);
if (startAt < 0) {
  console.error(`Couldn't find the TRAIL_PHOTOS list in ${PHOTOS_FILE}. Nothing changed.`);
  process.exit(1);
}

const hasEntry = id => new RegExp(`\\n  ${id}: \\{`).test(text);

/** Removes one entry — only ever used for ids this helper added. */
function removeEntry(id, keepFile) {
  const re = new RegExp(`\\n  ${id}: \\{[\\s\\S]*?\\n  \\},`);
  const block = text.match(re)?.[0] ?? '';
  // Delete the old image too, if it was a different file (e.g. .jpg -> .png).
  const oldUrl = block.match(/url: "assets\/trails\/([^"]+)"/)?.[1];
  if (oldUrl && oldUrl !== keepFile && oldUrl.startsWith(id)) {
    try { unlinkSync(join(ASSET_DIR, oldUrl)); } catch { /* already gone */ }
  }
  text = text.replace(re, '');
}

function addEntry(id, p) {
  const entry =
    `\n  ${id}: {\n` +
    `    url: ${JSON.stringify(p.url)},\n` +
    `    credit: ${JSON.stringify(p.credit)},\n` +
    `    license: ${JSON.stringify(p.license)},\n` +
    `    source: ${JSON.stringify(p.source)},\n` +
    `  },`;
  const close = text.indexOf('\n};', text.indexOf(START));
  text = text.slice(0, close) + entry + text.slice(close);
}

// ── run ────────────────────────────────────────────────────────────────────

console.log(DRY ? 'DRY RUN: nothing will be written.\n' : 'Adding photos for trails that have none...\n');

const added = [];
const none = [];

for (const [id, spec] of Object.entries(MISSING)) {
  const repick = id in PICKS;

  if (hasEntry(id) && !repick) {
    console.log(`${id}  already has a photo, kept as is`);
    continue;
  }

  let list = [];
  try {
    list = await candidatesFor(spec);
  } catch (err) {
    console.warn(`${id}  ${spec.q[0]}: lookup failed (${err.message}). Check your internet and run again.`);
    continue;
  }

  if (!list.length) {
    await sleep(1500);
    none.push(`${id} ${spec.q[0]}`);
    console.log(`${id}  ${spec.q[0]}: no photo of this mountain on Commons, so it keeps the placeholder`);
    continue;
  }

  const index = Math.min((PICKS[id] ?? 1) - 1, list.length - 1);
  const pick = list[index];

  console.log(`${id}  ${spec.q[0]}`);
  list.slice(0, 5).forEach((c, i) => {
    console.log(`   ${i === index ? '>' : ' '}${i + 1}. ${c.title}  (${c.credit}, ${c.license})`);
  });
  console.log(`      ${pick.source}`);

  if (DRY) continue;

  const ext = (pick.thumb.match(/\.(jpe?g|png|webp)(?:$|\?)/i)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
  const file = `${id}.${ext}`;

  try {
    if (!existsSync(ASSET_DIR)) mkdirSync(ASSET_DIR, { recursive: true });
    await download(pick.thumb, join(ASSET_DIR, file));
  } catch (err) {
    console.warn(`      download failed (${err.message}), skipped`);
    continue;
  }

  if (hasEntry(id)) removeEntry(id, file);
  addEntry(id, {
    url: `assets/trails/${file}`,
    credit: pick.credit,
    license: pick.license,
    source: pick.source,
  });
  added.push(id);

  // Be polite to a free service.
  await sleep(1500);
}

if (!DRY && added.length) {
  writeFileSync(PHOTOS_FILE, text.replace(/\n/g, EOL), 'utf8');
}

console.log('');
if (DRY) {
  console.log('Dry run finished. Run again without --dry to add them.');
} else {
  console.log(`Added ${added.length} photo(s)${added.length ? ': ' + added.join(', ') : ''}.`);
  if (none.length) console.log(`Still placeholder (no photo found): ${none.join(', ')}`);
  console.log('Open each source link above to double-check the photo is the right mountain.');
  console.log('Don\'t like one? Run again with --pick=ID:2 to use the next candidate.');
}
