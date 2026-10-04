import { Injectable, computed, signal } from '@angular/core';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TRAIL WEATHER SERVICE — real forecasts, one per mountain
 *
 * A NEW file. The existing weather.service.ts is untouched, so whoever owns it
 * keeps their work; this sits alongside it.
 *
 * SOURCE: Open-Meteo (https://open-meteo.com). Chosen because it needs no API
 * key, no account and no server of our own, allows browser requests directly,
 * and is free for non-commercial use. If this ever becomes a commercial
 * product, that licence changes — check their terms before shipping.
 *
 * WHY `elevation` IS PASSED
 * Weather models run on a coarse terrain grid, so the default forecast for a
 * mountain's coordinates is really the forecast for a smoothed-out version of
 * that landscape — often a thousand metres below the actual summit. Passing
 * the summit elevation makes Open-Meteo downscale temperature to that height.
 * It is the difference between "22°C at Pulag" and the near-freezing dawn the
 * mountain actually delivers.
 *
 * WHAT THIS IS NOT
 * A model forecast is not a summit weather station. Mountains make their own
 * weather — a ridge can be in cloud while the valley 3 km away is clear, and
 * conditions can turn in under an hour. The UI says so, and it should keep
 * saying so. Nobody should be deciding whether to climb on this alone.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const API = 'https://api.open-meteo.com/v1/forecast';

/** How long a fetched forecast is reused before we go back to the network. */
const TTL_MS = 30 * 60 * 1000;

/** Days of outlook requested. 5 covers "this weekend" from any weekday. */
const FORECAST_DAYS = 5;

export type AlertLevel = 'info' | 'caution' | 'danger';

export interface WeatherAlert {
  level: AlertLevel;
  icon: string;
  title: string;
  detail: string;
}

export interface HourForecast {
  /** "14:00" */
  label: string;
  tempC: number;
  rainMm: number;
  rainChance: number;
  icon: string;
}

export interface DayForecast {
  /** "Mon" — or "Today" for the first entry. */
  label: string;
  icon: string;
  summary: string;
  tempMaxC: number;
  tempMinC: number;
  rainMm: number;
  rainChance: number;
  gustKph: number;
}

export type RainIntensity = 'None' | 'Light' | 'Moderate' | 'Heavy';

export interface TrailForecast {
  fetchedAt: number;
  /** Elevation the model actually downscaled to, in metres. */
  modelElevationM: number;
  tempC: number;
  feelsLikeC: number;
  humidity: number;
  rainMmPerHour: number;
  rainIntensity: RainIntensity;
  summary: string;
  icon: string;
  windKph: number;
  gustKph: number;
  hourly: HourForecast[];
  days: DayForecast[];
  alerts: WeatherAlert[];
}

export interface ForecastRequest {
  /** Trail id — the cache key. */
  id: string;
  lat: number;
  lng: number;
  /** Summit elevation in metres. Strongly recommended. */
  elevationM?: number;
  /** e.g. "Grassland", "Limestone / River". Shapes which alerts fire. */
  trailType?: string;
}

export interface ForecastState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data?: TrailForecast;
  error?: string;
}

const IDLE: ForecastState = { status: 'idle' };

// ── WMO weather codes ───────────────────────────────────────────────────────
// Open-Meteo reports conditions as WMO code 4677. Snow and freezing codes are
// included for completeness; they will not fire in the Philippines.

interface CodeInfo { summary: string; icon: string; }

function describeCode(code: number): CodeInfo {
  if (code === 0) return { summary: 'Clear sky', icon: 'sunny-outline' };
  if (code === 1) return { summary: 'Mainly clear', icon: 'partly-sunny-outline' };
  if (code === 2) return { summary: 'Partly cloudy', icon: 'partly-sunny-outline' };
  if (code === 3) return { summary: 'Overcast', icon: 'cloudy-outline' };
  if (code === 45 || code === 48) return { summary: 'Fog', icon: 'cloudy-outline' };
  if (code >= 51 && code <= 57) return { summary: 'Drizzle', icon: 'rainy-outline' };
  if (code === 61) return { summary: 'Light rain', icon: 'rainy-outline' };
  if (code === 63) return { summary: 'Moderate rain', icon: 'rainy-outline' };
  if (code === 65) return { summary: 'Heavy rain', icon: 'rainy-outline' };
  if (code === 66 || code === 67) return { summary: 'Freezing rain', icon: 'rainy-outline' };
  if (code >= 71 && code <= 77) return { summary: 'Snow', icon: 'snow-outline' };
  if (code === 80) return { summary: 'Light showers', icon: 'rainy-outline' };
  if (code === 81) return { summary: 'Showers', icon: 'rainy-outline' };
  if (code === 82) return { summary: 'Violent showers', icon: 'rainy-outline' };
  if (code === 85 || code === 86) return { summary: 'Snow showers', icon: 'snow-outline' };
  if (code === 95) return { summary: 'Thunderstorm', icon: 'thunderstorm-outline' };
  if (code === 96 || code === 99) return { summary: 'Thunderstorm, hail', icon: 'thunderstorm-outline' };
  return { summary: 'Unknown', icon: 'cloudy-outline' };
}

function isThunderstorm(code: number): boolean {
  return code >= 95 && code <= 99;
}

/**
 * Rainfall intensity, using PAGASA's published categories:
 *   Light     trace to 2.5 mm/h
 *   Moderate  2.5 – 7.5 mm/h
 *   Heavy     above 7.5 mm/h
 * https://www.pagasa.dost.gov.ph/information/weather-terminologies
 *
 * Using the national service's own thresholds means the app's wording matches
 * what a Filipino hiker hears on the radio that morning.
 */
function classifyRain(mmPerHour: number): RainIntensity {
  if (mmPerHour <= 0) return 'None';
  if (mmPerHour <= 2.5) return 'Light';
  if (mmPerHour <= 7.5) return 'Moderate';
  return 'Heavy';
}

/** Trails whose route involves water that rises. */
function isRiverRoute(trailType?: string): boolean {
  return /river|falls/i.test(trailType ?? '');
}

/** Trails with little or no canopy, where sun and wind are unfiltered. */
function isExposedRoute(trailType?: string): boolean {
  return /grass|coastal|ridge|rock|plateau|pasture|volcanic|limestone|karst/i.test(
    trailType ?? '',
  );
}

@Injectable({ providedIn: 'root' })
export class TrailWeatherService {
  private readonly _states = signal<Record<string, ForecastState>>({});

  /** All cached states, keyed by trail id. */
  readonly states = computed(() => this._states());

  /** Ids currently in flight, so a re-render cannot start a second request. */
  private readonly inFlight = new Set<string>();

  stateFor(id: string): ForecastState {
    return this._states()[id] ?? IDLE;
  }

  /**
   * Fetches unless a fresh forecast is already cached. Safe to call on every
   * render — it is a no-op when the cache is warm.
   */
  load(req: ForecastRequest, force = false) {
    const existing = this._states()[req.id];

    if (!force && existing?.status === 'ready' && existing.data) {
      if (Date.now() - existing.data.fetchedAt < TTL_MS) return;
    }
    if (this.inFlight.has(req.id)) return;

    this.inFlight.add(req.id);
    this.patch(req.id, { status: 'loading', data: existing?.data });

    this.fetchForecast(req)
      .then(data => this.patch(req.id, { status: 'ready', data }))
      .catch((err: unknown) => {
        console.warn('[TrailWeather] fetch failed for', req.id, err);
        this.patch(req.id, {
          status: 'error',
          // Keep any previous reading on screen rather than blanking it; a
          // forecast from 40 minutes ago beats no forecast at all, as long as
          // the UI says how old it is.
          data: existing?.data,
          error: 'Could not reach the forecast service.',
        });
      })
      .finally(() => this.inFlight.delete(req.id));
  }

  private patch(id: string, state: ForecastState) {
    this._states.update(all => ({ ...all, [id]: state }));
  }

  // ── network ─────────────────────────────────────────────────────────────

  /**
   * Plain `fetch`, not HttpClient — this service then has no dependency on
   * provideHttpClient() being present in the app config, so dropping it into
   * the project cannot break anyone else's bootstrap.
   */
  private async fetchForecast(req: ForecastRequest): Promise<TrailForecast> {
    const params = new URLSearchParams({
      latitude: String(req.lat),
      longitude: String(req.lng),
      current: [
        'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
        'precipitation', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m',
      ].join(','),
      hourly: [
        'temperature_2m', 'precipitation', 'precipitation_probability',
        'weather_code',
      ].join(','),
      daily: [
        'weather_code', 'temperature_2m_max', 'temperature_2m_min',
        'precipitation_sum', 'precipitation_probability_max',
        'wind_gusts_10m_max',
      ].join(','),
      timezone: 'Asia/Manila',
      forecast_days: String(FORECAST_DAYS),
    });

    if (req.elevationM) params.set('elevation', String(req.elevationM));

    const res = await fetch(`${API}?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json: any = await res.json();
    return this.parse(json, req);
  }

  private parse(json: any, req: ForecastRequest): TrailForecast {
    const c = json.current ?? {};
    const code = Number(c.weather_code ?? 0);
    const info = describeCode(code);
    const rainMmPerHour = Number(c.precipitation ?? 0);

    const hourly = this.parseHourly(json);
    const days = this.parseDays(json);

    const forecast: TrailForecast = {
      fetchedAt: Date.now(),
      modelElevationM: Math.round(Number(json.elevation ?? req.elevationM ?? 0)),
      tempC: Math.round(Number(c.temperature_2m ?? 0)),
      feelsLikeC: Math.round(Number(c.apparent_temperature ?? c.temperature_2m ?? 0)),
      humidity: Math.round(Number(c.relative_humidity_2m ?? 0)),
      rainMmPerHour,
      rainIntensity: classifyRain(rainMmPerHour),
      summary: info.summary,
      icon: info.icon,
      windKph: Math.round(Number(c.wind_speed_10m ?? 0)),
      gustKph: Math.round(Number(c.wind_gusts_10m ?? 0)),
      hourly,
      days,
      alerts: [],
    };

    forecast.alerts = this.buildAlerts(forecast, code, hourly, days, req);
    return forecast;
  }

  private parseHourly(json: any): HourForecast[] {
    const h = json.hourly;
    if (!h?.time?.length) return [];

    // Open-Meteo returns local times as "2026-10-04T15:00". Line up with the
    // hour `current` reports rather than the device clock, so a phone in the
    // wrong timezone still shows the right column.
    const nowHour = String(json.current?.time ?? '').slice(0, 13);
    let start = h.time.findIndex((t: string) => t.startsWith(nowHour));
    if (start < 0) start = 0;

    return h.time.slice(start, start + 12).map((t: string, i: number) => {
      const idx = start + i;
      return {
        label: t.slice(11, 16),
        tempC: Math.round(Number(h.temperature_2m?.[idx] ?? 0)),
        rainMm: Number(h.precipitation?.[idx] ?? 0),
        rainChance: Math.round(Number(h.precipitation_probability?.[idx] ?? 0)),
        icon: describeCode(Number(h.weather_code?.[idx] ?? 0)).icon,
      };
    });
  }

  private parseDays(json: any): DayForecast[] {
    const d = json.daily;
    if (!d?.time?.length) return [];

    return d.time.map((t: string, i: number) => {
      const info = describeCode(Number(d.weather_code?.[i] ?? 0));
      return {
        label: i === 0
          ? 'Today'
          : new Date(t + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short' }),
        icon: info.icon,
        summary: info.summary,
        tempMaxC: Math.round(Number(d.temperature_2m_max?.[i] ?? 0)),
        tempMinC: Math.round(Number(d.temperature_2m_min?.[i] ?? 0)),
        rainMm: Math.round(Number(d.precipitation_sum?.[i] ?? 0) * 10) / 10,
        rainChance: Math.round(Number(d.precipitation_probability_max?.[i] ?? 0)),
        gustKph: Math.round(Number(d.wind_gusts_10m_max?.[i] ?? 0)),
      };
    });
  }

  // ── alerts ──────────────────────────────────────────────────────────────

  /**
   * Turns numbers into advice. Every rule below is derived from the fetched
   * data — nothing here is decorative, and nothing fires without a reading
   * behind it.
   *
   * The wind and cold thresholds are this app's judgement rather than a
   * national standard, chosen to match how the conditions actually feel on an
   * exposed Philippine ridge. Have someone who guides these mountains review
   * them before you rely on them.
   */
  private buildAlerts(
    f: TrailForecast,
    currentCode: number,
    hourly: HourForecast[],
    days: DayForecast[],
    req: ForecastRequest,
  ): WeatherAlert[] {
    const alerts: WeatherAlert[] = [];
    const today = days[0];
    const elevation = f.modelElevationM;
    const exposed = isExposedRoute(req.trailType);
    const river = isRiverRoute(req.trailType);

    // 1. Lightning. The most serious thing on this list: a summit or an open
    //    ridge is the worst place to be, and there is no safe way to wait it
    //    out up there.
    if (isThunderstorm(currentCode)) {
      alerts.push({
        level: 'danger',
        icon: 'thunderstorm-outline',
        title: 'Thunderstorm right now',
        detail: 'Lightning risk. Summits and open ridges are the most exposed '
          + 'ground on the mountain — descend into tree cover and wait it out.',
      });
    }

    // 2. Heavy rain, by PAGASA's own threshold.
    if (f.rainIntensity === 'Heavy') {
      alerts.push({
        level: 'danger',
        icon: 'rainy-outline',
        title: `Heavy rain — ${f.rainMmPerHour.toFixed(1)} mm/h`,
        detail: river
          ? 'River levels rise fast in this kind of rain, and crossings that '
            + 'were ankle-deep on the way in may be impassable on the way out. '
            + 'Postpone.'
          : 'Trails turn to mud and rock becomes slippery. Descents are where '
            + 'most injuries happen in these conditions.',
      });
    } else if (f.rainIntensity === 'Moderate') {
      alerts.push({
        level: 'caution',
        icon: 'rainy-outline',
        title: `Moderate rain — ${f.rainMmPerHour.toFixed(1)} mm/h`,
        detail: 'Expect mud and slick rock. Pack a dry bag and allow extra '
          + 'time for the descent.',
      });
    }

    // 3. A wet day ahead even if it is dry at this moment. 30 mm over a day is
    //    enough to soak a trail through; 50 mm makes river routes a bad idea.
    if (f.rainIntensity === 'None' && today && today.rainMm >= 30) {
      alerts.push({
        level: today.rainMm >= 50 ? 'danger' : 'caution',
        icon: 'water-outline',
        title: `${today.rainMm} mm of rain expected today`,
        detail: river
          ? 'Enough to raise the river. Ask locally about crossings before '
            + 'committing to the route.'
          : 'Dry now, but the day is forecast wet. Pack for it.',
      });
    }

    // 4. Wind. A narrow ridge in a strong gust is a balance problem, not a
    //    comfort one.
    const gust = Math.max(f.gustKph, today?.gustKph ?? 0);
    if (gust >= 60) {
      alerts.push({
        level: 'danger',
        icon: 'flag-outline',
        title: `Gusts to ${gust} km/h`,
        detail: 'Strong enough to unbalance you on an exposed ridge or a '
          + 'scramble. Not a day for narrow ground.',
      });
    } else if (gust >= 40 && exposed) {
      alerts.push({
        level: 'caution',
        icon: 'flag-outline',
        title: `Windy — gusts to ${gust} km/h`,
        detail: 'This route is exposed. Secure hats and loose gear, and take '
          + 'extra care on the ridge sections.',
      });
    }

    // 5. Cold. Lowland hikers routinely underestimate high Luzon at dawn, and
    //    hypothermia here has killed people who packed for Manila weather.
    const low = today?.tempMinC ?? f.tempC;
    if (elevation >= 1500 && low <= 12) {
      alerts.push({
        level: low <= 7 ? 'danger' : 'caution',
        icon: 'snow-outline',
        title: `Cold at altitude — down to ${low}°C`,
        detail: 'Wet and windy at this temperature is how hypothermia starts. '
          + 'Bring insulation and a waterproof layer, not just a jacket.',
      });
    }

    // 6. Heat on unshaded ground. The stories for these trails say it
    //    repeatedly: the grasslands bake by mid-morning.
    if (exposed && f.feelsLikeC >= 33) {
      alerts.push({
        level: f.feelsLikeC >= 38 ? 'danger' : 'caution',
        icon: 'sunny-outline',
        title: `Feels like ${f.feelsLikeC}°C`,
        detail: 'Little or no shade on this route. Start at first light, carry '
          + 'more water than the distance suggests, and turn back if anyone '
          + 'stops sweating.',
      });
    }

    // 7. Fog. Not dangerous in itself; dangerous combined with a cliff.
    if (currentCode === 45 || currentCode === 48) {
      alerts.push({
        level: 'caution',
        icon: 'cloudy-outline',
        title: 'Fog on the mountain',
        detail: 'Visibility is poor and trail junctions are easy to miss. '
          + 'Stay with your guide and do not scout ahead alone.',
      });
    }

    // 8. Thunderstorms later today, even if it is clear now. This is the one
    //    that changes what time you start.
    if (!isThunderstorm(currentCode)) {
      const stormHour = hourly.find(h => h.rainChance >= 70 && h.rainMm >= 2);
      if (stormHour) {
        alerts.push({
          level: 'caution',
          icon: 'time-outline',
          title: `Rain likely around ${stormHour.label}`,
          detail: `${stormHour.rainChance}% chance. Plan to be off the summit `
            + 'before then — afternoon weather builds fast on Philippine peaks.',
        });
      }
    }

    // 9. Nothing wrong. Say so plainly rather than showing an empty panel.
    if (!alerts.length) {
      alerts.push({
        level: 'info',
        icon: 'checkmark-circle-outline',
        title: 'Conditions look good',
        detail: 'No warnings from the forecast. Mountain weather still changes '
          + 'faster than any model — check again the morning you climb.',
      });
    }

    // Most serious first. The compact card shows only alerts[0], so this is
    // what decides whether a hiker sees "windy" or "thunderstorm" at a glance.
    const rank: Record<AlertLevel, number> = { danger: 0, caution: 1, info: 2 };
    return alerts.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  // ── helpers for the UI ──────────────────────────────────────────────────

  /** "Updated 4 min ago". */
  freshness(data?: TrailForecast): string {
    if (!data) return '';
    const mins = Math.floor((Date.now() - data.fetchedAt) / 60000);
    if (mins < 1) return 'Updated just now';
    if (mins === 1) return 'Updated 1 min ago';
    if (mins < 60) return `Updated ${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    return `Updated ${hrs}h ago`;
  }

  /** Worst level among the alerts, for the summary strip's colour. */
  worstLevel(data?: TrailForecast): AlertLevel {
    if (!data?.alerts.length) return 'info';
    if (data.alerts.some(a => a.level === 'danger')) return 'danger';
    if (data.alerts.some(a => a.level === 'caution')) return 'caution';
    return 'info';
  }
}
