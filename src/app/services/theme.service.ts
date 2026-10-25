/**
 * Theme service: stores and applies the selected appearance so app pages can share the same theme state.
 */
import { DOCUMENT } from '@angular/common';
import { Inject, Injectable, signal } from '@angular/core';

const THEME_STORAGE_KEY = 'trailbound-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly isLight = signal(false);

  private readonly document: Document;

  constructor(@Inject(DOCUMENT) document: Document) {
    this.document = document;
    const savedTheme = document.defaultView?.localStorage.getItem(THEME_STORAGE_KEY);
    this.applyTheme(savedTheme === 'light');
  }

  /** Stores the set light mode selection so the related view and feature logic stay in sync. */
  setLightMode(enabled: boolean): void {
    this.document.defaultView?.localStorage.setItem(
      THEME_STORAGE_KEY,
      enabled ? 'light' : 'dark',
    );
    this.applyTheme(enabled);
  }

  /** Performs the apply theme operation for this feature and returns its result to the caller. */
  private applyTheme(enabled: boolean): void {
    this.isLight.set(enabled);
    this.document.documentElement.dataset['theme'] = enabled ? 'light' : 'dark';
  }
}
