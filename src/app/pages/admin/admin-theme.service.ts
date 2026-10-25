/**
 * The admin panel's own light/dark setting.
 *
 * Deliberately separate from the hiker app's ThemeService. The panel is used
 * on a laptop and the app on a phone, often by the same person at different
 * times of day, so one shared switch would mean changing the app's appearance
 * to get the panel the way you want it. Two settings, no interference.
 *
 * The value is written to the shell element as data-tba-theme, so every rule
 * in admin-dark.css is scoped under `.tba` and nothing can leak into the
 * hiker app — unlike a flag on <html>, which both would see.
 *
 * Stored per browser in localStorage. It is a display preference, so there is
 * nothing to sync and nothing worth a Firestore write; a colleague signing in
 * on their own machine gets their own setting, which is the behaviour you
 * want.
 */
import { Injectable, computed, signal } from '@angular/core';

export type AdminTheme = 'dark' | 'light';

const KEY = 'tba.theme';

/**
 * Dark is the default, matching the hiker app's look. Any read can throw in a
 * private window or with site data blocked, so it is wrapped — a panel that
 * fails to open because of a theme preference would be a poor trade.
 */
function readStored(): AdminTheme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

@Injectable({ providedIn: 'root' })
export class AdminThemeService {
  private readonly _mode = signal<AdminTheme>(readStored());

  /** 'dark' | 'light' — bound to data-tba-theme on the shell. */
  readonly mode = this._mode.asReadonly();

  readonly isDark = computed(() => this._mode() === 'dark');

  /** Updates the requested state so dependent views can react to the change. */
  set(mode: AdminTheme): void {
    this._mode.set(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // Private window or blocked site data: the choice still applies for
      // this session, it just will not be remembered.
    }
  }

  /** Switches the requested setting or panel between its available states. */
  toggle(): void {
    this.set(this.isDark() ? 'light' : 'dark');
  }
}
