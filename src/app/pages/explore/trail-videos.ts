/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TRAIL VIDEOS — one link per mountain, keyed by Trail.id
 *
 * Same side-table pattern as trail-photos.ts: additive, nothing here touches
 * trail.model.ts or trail.service.ts.
 *
 * ── READ THIS BEFORE TRUSTING ANY ENTRY ───────────────────────────────────
 *
 * These links came from a search, not from anyone who has climbed these
 * mountains. I have NOT opened them. Three things can be wrong with any row:
 *
 *   1. The link is dead. Video platforms remove uploads constantly.
 *   2. It is the wrong mountain. Search results confuse peaks with similar
 *      names, and "view FROM Mt. X" is not "video OF Mt. X".
 *   3. The content is unsuitable — an advert, a vlog about the drive there,
 *      or someone's unrelated travel montage.
 *
 * Spot-check every one before this is shown to anyone. It takes a minute per
 * mountain and it is the difference between a demo and a product.
 *
 * ── NOT EVERYTHING HERE IS A VIDEO ────────────────────────────────────────
 *
 * Eleven of these are articles, trip reports or tourism pages rather than
 * videos. They are marked `kind: 'page'` and the UI renames the button to
 * "Read trail guide" and opens them in the browser, because tapping "Watch
 * trail video" and landing on a blog post is a promise the app did not keep.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type VideoKind = 'youtube' | 'vimeo' | 'dailymotion' | 'page';

export interface TrailVideo {
  kind: VideoKind;
  /** Platform video id, used to build the embed URL. Absent for 'page'. */
  videoId?: string;
  /** The original link. Always present — shown as "Open original". */
  url: string;
  /** Publisher, shown under the player. A courtesy and often a condition. */
  source: string;
  /** Set where the link looks questionable. See the notes above. */
  note?: string;
}

export const TRAIL_VIDEOS: Record<string, TrailVideo> = {
  T001: {
    kind: 'youtube', videoId: '5r60jDaKr9A',
    url: 'https://www.youtube.com/watch?v=5r60jDaKr9A',
    source: 'YouTube',
  },
  T002: {
    kind: 'page',
    url: 'https://batangasmagiting.com/Destination/Details?id=11&nativex=false',
    source: 'Batangas Tourism',
    note: 'Destination page, not a video.',
  },
  T003: {
    kind: 'page',
    url: 'https://www.gmanetwork.com/news/lifestyle/travel/552716/trek-diary-the-clouds-over-mount-ulap/story/',
    source: 'GMA Network',
    note: 'Written trek diary, not a video.',
  },
  T004: {
    kind: 'youtube', videoId: 'dgtPtc8vNyU',
    url: 'https://www.youtube.com/watch?v=dgtPtc8vNyU',
    source: 'YouTube',
  },
  T005: {
    kind: 'dailymotion', videoId: 'x8k82nw',
    url: 'https://www.dailymotion.com/video/x8k82nw',
    source: 'Dailymotion',
  },
  T006: {
    kind: 'vimeo', videoId: '71190174',
    url: 'https://vimeo.com/71190174',
    source: 'Vimeo',
  },
  T007: {
    kind: 'youtube', videoId: 'AjVpdJ9ERk0',
    url: 'https://www.youtube.com/watch?v=AjVpdJ9ERk0',
    source: 'YouTube',
  },
  T008: {
    kind: 'youtube', videoId: 'lnK4WQLBtHM',
    url: 'https://www.youtube.com/watch?v=lnK4WQLBtHM',
    source: 'YouTube',
  },
  T009: {
    kind: 'youtube', videoId: 'kq3ICJOyyUc',
    url: 'https://www.youtube.com/watch?v=kq3ICJOyyUc',
    source: 'YouTube',
  },
  T010: {
    kind: 'page',
    url: 'https://www.gmanetwork.com/news/publicaffairs/iwitness/310232/ang-misteryosong-mt-maculot-aakyatin-ni-jay-taruc-sa-i-witness/story/',
    source: 'GMA I-Witness',
    note: 'Programme page. May hold an embedded video; GMA blocks embedding.',
  },
  T011: {
    kind: 'youtube', videoId: 'F4kzfwH7IGQ',
    url: 'https://www.youtube.com/watch?v=F4kzfwH7IGQ',
    source: 'YouTube',
  },
  T012: {
    kind: 'dailymotion', videoId: 'x7z5ewb',
    url: 'https://www.dailymotion.com/video/x7z5ewb',
    source: 'Dailymotion',
  },
  T013: {
    kind: 'page',
    url: 'https://www.rrhct.com/2020/07/mendaki-gn-pamitinan-gn-binacayan.html',
    source: 'rrhct.com',
    note: 'Indonesian-language blog post. Check it is about the right peak.',
  },
  T014: {
    kind: 'vimeo', videoId: '248599579',
    url: 'https://vimeo.com/248599579',
    source: 'Vimeo',
  },
  T015: {
    kind: 'youtube', videoId: 'Uo73FVT76XM',
    url: 'https://www.youtube.com/watch?v=Uo73FVT76XM',
    source: 'YouTube',
  },
  T016: {
    kind: 'page',
    url: 'https://chasejase.com/mt-daraitan-atburan-rockies-guide/',
    source: 'chasejase.com',
    note: 'Written trail guide, not a video.',
  },
  T017: {
    kind: 'page',
    url: 'https://www.gmanetwork.com/entertainment/showbiznews/klea-pineda-at-katrice-kierulf-may-nature-adventure-sa-tanay-rizal/110210/',
    source: 'GMA Entertainment',
    note: 'Showbiz article about a Tanay trip — may not feature Mt. Kulis.',
  },
  T018: {
    kind: 'youtube', videoId: 'QJOqec3eEHQ',
    url: 'https://www.youtube.com/watch?v=QJOqec3eEHQ',
    source: 'YouTube',
  },
  T019: {
    kind: 'page',
    url: 'https://galamalayablog.wordpress.com/2014/02/10/mtsembrano/',
    source: 'Gala Malaya',
    note: 'Blog trip report from 2014. Conditions will have changed.',
  },
  T020: {
    kind: 'youtube', videoId: '8jBHGlZpGcU',
    url: 'https://www.youtube.com/watch?v=8jBHGlZpGcU',
    source: 'YouTube',
  },
  T021: {
    kind: 'page',
    url: 'https://www.gmanetwork.com/entertainment/videos/amazing-earth-misteryo-ng-mt-makiling-teaser-ep-6/83313/',
    source: 'GMA Amazing Earth',
    note: 'A teaser clip on GMA\'s own player, which does not allow embedding.',
  },
  T022: {
    kind: 'youtube', videoId: 'BaYkJItDFWU',
    url: 'https://www.youtube.com/watch?v=BaYkJItDFWU',
    source: 'YouTube',
  },
  T023: {
    kind: 'page',
    url: 'https://www.lagataw.com/2011/07/mt-cristobal-traverse-day-hike-video.html',
    source: 'Lagataw',
    note: 'Blog post containing a video. From 2011 — the embed may be dead.',
  },
  T024: {
    kind: 'page',
    url: 'https://galamalayablog.wordpress.com/',
    source: 'Gala Malaya',
    note: 'THIS IS THE BLOG HOMEPAGE, not a post about Gulugod Baboy. '
      + 'Replace it or remove this entry — it tells the user nothing.',
  },
  T025: {
    kind: 'page',
    url: 'https://ditokayshellan.com/2017/08/11/wet-and-mildly-wild-adventure-at-mt-marami/',
    source: 'Dito Kay Shellan',
    note: 'Blog trip report, not a video.',
  },
  // T026 (Mt. Pigingan) — deliberately absent. No video was found, and the UI
  // says so rather than sending the user somewhere unrelated.
  T027: {
    kind: 'dailymotion', videoId: 'x9hwva0',
    url: 'https://www.dailymotion.com/video/x9hwva0',
    source: 'Dailymotion',
  },
  T028: {
    kind: 'youtube', videoId: 'ZiP5cujl6CY',
    url: 'https://www.youtube.com/watch?v=ZiP5cujl6CY',
    source: 'YouTube',
  },
  T029: {
    kind: 'page',
    url: 'https://highlandreflections.com/2024/07/18/mt-labo-1544-masl-into-the-jungle-of-camarines-norte/',
    source: 'Highland Reflections',
    note: 'Blog trip report, not a video.',
  },
  T030: {
    kind: 'youtube', videoId: 'x2tF2MzZgt4',
    url: 'https://www.youtube.com/watch?v=x2tF2MzZgt4',
    source: 'YouTube',
  },
};

/** The video or article recorded for a trail, if any. */
export function videoFor(id: string): TrailVideo | undefined {
  return TRAIL_VIDEOS[id];
}

/**
 * The URL to put in an iframe, or null when this entry cannot be embedded.
 *
 * YouTube goes through youtube-nocookie.com: same player, but it does not set
 * tracking cookies until the viewer actually presses play. There is no reason
 * to track your users on a hiking app's behalf.
 */
export function embedUrlFor(v: TrailVideo): string | null {
  if (!v.videoId) return null;
  switch (v.kind) {
    case 'youtube':
      return `https://www.youtube-nocookie.com/embed/${v.videoId}?rel=0`;
    case 'vimeo':
      return `https://player.vimeo.com/video/${v.videoId}`;
    case 'dailymotion':
      return `https://www.dailymotion.com/embed/video/${v.videoId}`;
    default:
      return null;
  }
}

/** True when this trail has something playable in-app. */
export function isPlayable(v: TrailVideo | undefined): boolean {
  return !!v && v.kind !== 'page';
}
