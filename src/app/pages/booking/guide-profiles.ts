/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GUIDE PROFILES — the extra details shown on each guide's box
 *
 * A side table, so booking.model.ts and booking-catalog.ts stay untouched.
 * Matched to the GUIDES roster by the guide's name: if a guide is renamed in
 * booking-catalog.ts, rename them here too. A guide with no entry here still
 * shows, just without the bio, specialties and languages.
 *
 * SAMPLE CONTENT — the roster is a placeholder, so these details are too.
 * Replace them with your real guides' information.
 *
 * Photos: put one image per guide in  src/assets/guides/  named after the
 * guide in lowercase with dashes, e.g.  ramon-santos.jpg . Until a photo is
 * there, the box shows the guide's initial instead.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface GuideProfile {
  /** Short role line under the name. */
  title: string;
  /** One or two sentences about the guide. */
  bio: string;
  /** Shown as small tags. Keep to about three. */
  specialties: string[];
  languages: string[];
}

export const GUIDE_PROFILES: Record<string, GuideProfile> = {
  'Ramon Santos': {
    title: 'Lead mountain guide',
    bio: 'Has led sunrise climbs across the Cordillera for over a decade. Keeps a calm, steady pace that suits first-time hikers.',
    specialties: ['Sunrise summits', 'Cordillera trails', 'First-timers'],
    languages: ['Filipino', 'English', 'Ilocano'],
  },
  'Liza Reyes': {
    title: 'Trail & safety guide',
    bio: 'Known for clear safety briefings and unhurried photo stops. Leads most of the waterfall and tree-planting hikes.',
    specialties: ['Waterfall trails', 'Tree planting', 'Photo stops'],
    languages: ['Filipino', 'English', 'Cebuano'],
  },
  'Joel Bautista': {
    title: 'Adventure guide',
    bio: 'The guide to pick for a challenge: ridge traverses, overnight camps and canyoneering routes.',
    specialties: ['Overnight camps', 'Ridge traverses', 'Canyoneering'],
    languages: ['Filipino', 'English'],
  },
};

/** "Ramon Santos" -> "assets/guides/ramon-santos.jpg" */
export function guidePhotoPath(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `assets/guides/${slug}.jpg`;
}

/** Merchandise photos live in  src/assets/merch/  named by item id, e.g. keychain.jpg */
export function merchPhotoPath(id: string): string {
  return `assets/merch/${id}.jpg`;
}
