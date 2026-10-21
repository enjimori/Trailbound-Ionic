/**
 * Admin shell — sidebar, top bar (search, activity, account) and the shared
 * look every admin page builds on.
 *
 * The styles here are global to the admin area on purpose
 * (ViewEncapsulation.None), but every selector sits under `.tba`, so nothing
 * leaks into the hiker app. Pages use these building blocks — .tba-card,
 * .tba-table, .tba-btn, .tba-badge, .tba-drawer — and only add layout.
 */
import { Component, OnDestroy, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chatbubblesOutline, closeOutline, gridOutline, logOutOutline, menuOutline, notificationsOutline,
  peopleOutline, phonePortraitOutline, pricetagsOutline, receiptOutline, searchOutline,
  settingsOutline, starOutline, trailSignOutline, alertCircleOutline, checkmarkCircle,
  documentAttachOutline,
} from 'ionicons/icons';
import { Subscription, filter } from 'rxjs';

import { AdminAuthService } from '../admin-auth.service';
import { AdminDataService } from '../admin-data.service';
import { AdminUiService } from '../admin-ui.service';
import { initials, matches, timeAgo, tintFor } from '../admin-utils';
import { allTrails } from '../../explore/trail-lookup';

interface NavItem { path: string; label: string; icon: string; exact?: boolean; badge?: () => number }

interface SearchHit { kind: string; label: string; sub: string; path: string; open: string }

interface ActivityItem { at: Date; icon: string; text: string; path: string; open: string }

const SEEN_KEY = 'tba.activitySeen';

@Component({
  selector: 'app-admin-shell',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, IonIcon],
  template: `
    <div class="tba" [class.rail-mode]="railMode()" [class.nav-open]="navOpen()">
      <aside class="tba-side" aria-label="Admin navigation">
        <a class="tba-brand" routerLink="/admin" (click)="navOpen.set(false)">
          <img src="assets/logo/trailbound-badge.png" alt="" />
          <span>TrailBound<i>.</i></span>
        </a>

        <nav class="tba-nav">
          @for (item of nav; track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: !!item.exact }"
              (click)="navOpen.set(false)"
            >
              <ion-icon [name]="item.icon"></ion-icon>
              <span>{{ item.label }}</span>
              @if (item.badge && item.badge()) { <em class="tba-count">{{ item.badge() }}</em> }
            </a>
          }
        </nav>

        <div class="tba-side-foot">
          <a href="/tabs/home" target="_blank" rel="noopener">
            <ion-icon name="phone-portrait-outline"></ion-icon><span>Open hiker app</span>
          </a>
          <button type="button" (click)="signOut()">
            <ion-icon name="log-out-outline"></ion-icon><span>Log out</span>
          </button>
        </div>
      </aside>
      <div class="tba-scrim" (click)="navOpen.set(false)"></div>

      <div class="tba-main">
        <header class="tba-top">
          <div class="tba-top-left">
            <button type="button" class="tba-burger" aria-label="Open menu" (click)="navOpen.set(true)">
              <ion-icon name="menu-outline"></ion-icon>
            </button>

            <div class="tba-search" (focusout)="onSearchBlur($event)">
              <ion-icon name="search-outline"></ion-icon>
              <input
                type="search"
                placeholder="Search hikers, bookings, trails…"
                [ngModel]="term()"
                (ngModelChange)="term.set($event); searchOpen.set(true)"
                (focus)="searchOpen.set(true)"
                (keydown.enter)="goFirst()"
                (keydown.escape)="searchOpen.set(false)"
                aria-label="Search"
              />
              @if (searchOpen() && term().trim().length > 1) {
                <div class="tba-pop tba-search-pop">
                  @for (h of hits(); track h.kind + h.open) {
                    <button type="button" class="tba-hit" (mousedown)="go(h)">
                      <em>{{ h.kind }}</em>
                      <span>{{ h.label }}</span>
                      <small>{{ h.sub }}</small>
                    </button>
                  } @empty {
                    <p class="tba-pop-empty">Nothing matches “{{ term() }}”.</p>
                  }
                </div>
              }
            </div>
          </div>

          <div class="tba-top-right">
            <div class="tba-bell-wrap" (focusout)="onBellBlur($event)">
              <button type="button" class="tba-icon-btn" aria-label="Recent activity" (click)="toggleBell()">
                <ion-icon name="notifications-outline"></ion-icon>
                @if (unseen()) { <i class="tba-dot"></i> }
              </button>
              @if (bellOpen()) {
                <div class="tba-pop tba-bell-pop">
                  <h4>Recent activity</h4>
                  @for (a of activity(); track a.at.getTime() + a.text) {
                    <button type="button" class="tba-act" (mousedown)="openActivity(a)">
                      <ion-icon [name]="a.icon"></ion-icon>
                      <span>{{ a.text }}<small>{{ ago(a.at) }}</small></span>
                    </button>
                  } @empty {
                    <p class="tba-pop-empty">No activity yet.</p>
                  }
                </div>
              }
            </div>
            <a class="tba-me" routerLink="/admin/settings" [title]="admin()?.email ?? ''">
              <span class="tba-avatar" [style.background]="tint(admin()?.name ?? 'A')">{{ initialsOf(admin()?.name) }}</span>
            </a>
          </div>
        </header>

        @if (data.blocked().length) {
          <div class="tba-alert">
            <ion-icon name="alert-circle-outline"></ion-icon>
            <p>
              <strong>Firebase is blocking some admin data</strong>
              ({{ data.blocked().join(', ') }}). Publish the new <code>firestore.rules</code> from the
              project folder in Firebase console → Firestore Database → Rules, then reload this page.
            </p>
          </div>
        }

        <main class="tba-page">
          <router-outlet></router-outlet>
        </main>
      </div>

      <div class="tba-toasts" aria-live="polite">
        @for (t of ui.toasts(); track t.id) {
          <div class="tba-toast" [class.error]="t.tone === 'error'">
            <ion-icon [name]="t.tone === 'error' ? 'alert-circle-outline' : 'checkmark-circle'"></ion-icon>
            {{ t.message }}
          </div>
        }
      </div>

      @if (ui.dialog(); as d) {
        <div class="tba-modal-wrap" (click)="ui.close(null)">
          <div class="tba-modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
            <h3>{{ d.title }}</h3>
            <p>{{ d.message }}</p>
            @if (d.input) {
              <label class="tba-field">
                <span>{{ d.input.label }}</span>
                <input class="tba-input-box" [placeholder]="d.input.placeholder ?? ''" [(ngModel)]="d.value" maxlength="200" />
              </label>
            }
            <div class="tba-modal-actions">
              <button type="button" class="tba-btn ghost" (click)="ui.close(null)">Cancel</button>
              <button type="button" class="tba-btn" [class.danger-fill]="d.danger" [class.primary]="!d.danger" (click)="ui.close(d.value)">
                {{ d.confirmText ?? 'Confirm' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .tba {
      --tba-ink: #1d2420; --tba-ink-2: #2b3530; --tba-text: #1d2420; --tba-muted: #868b84;
      --tba-faint: #b3b6b0; --tba-line: #edede8; --tba-soft: #f6f6f2; --tba-sand: #dcb889;
      --tba-sand-soft: #f7ecdc; --tba-cream: #fbf6ec; --tba-sage: #edf2ea; --tba-up: #3b9459;
      --tba-down: #dc4f4b; --tba-amber: #c98a1b; --tba-rail: 320px; --tba-side: 236px;
      position: absolute; inset: 0; display: flex; background: #fff; color: var(--tba-text);
      color-scheme: light; font-family: 'Inter', system-ui, sans-serif; font-size: 14px;
      overflow: hidden;
    }
    /* :where() keeps these resets at zero specificity, so any class below wins. */
    :where(.tba) * { box-sizing: border-box; font-family: inherit; }
    .tba h1, .tba h2, .tba h3, .tba h4 { font-family: inherit; letter-spacing: -0.01em; margin: 0; color: var(--tba-text); }
    :where(.tba) button { font-family: inherit; font-size: 14px; color: inherit; cursor: pointer; }
    :where(.tba) a { color: inherit; text-decoration: none; }
    :where(.tba) ion-icon { flex: none; }

    /* ── sidebar ── */
    .tba-side { width: var(--tba-side); flex: none; display: flex; flex-direction: column; padding: 26px 18px 22px; border-right: 1px solid var(--tba-line); background: #fff; z-index: 30; }
    .tba-brand { display: flex; align-items: center; gap: 10px; padding: 0 8px 26px; font-size: 19px; font-weight: 700; }
    .tba-brand img { width: 34px; height: 34px; border-radius: 50%; }
    .tba-brand i { color: var(--tba-sand); font-style: normal; }
    .tba-nav { display: flex; flex-direction: column; gap: 4px; }
    .tba-nav a, .tba-side-foot a, .tba-side-foot button {
      display: flex; align-items: center; gap: 13px; padding: 11px 16px; border-radius: 999px;
      font-size: 14px; font-weight: 500; color: var(--tba-ink-2); border: 0; background: none; text-align: left; width: 100%;
    }
    .tba-nav a ion-icon, .tba-side-foot ion-icon { font-size: 19px; }
    .tba-nav a:hover, .tba-side-foot a:hover, .tba-side-foot button:hover { background: var(--tba-soft); }
    .tba-nav a.active { background: var(--tba-ink); color: #fff; }
    .tba-count { margin-left: auto; min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px; display: grid; place-items: center; font-style: normal; font-size: 11.5px; font-weight: 700; background: var(--tba-sand); color: var(--tba-ink); }
    .tba-side-foot { margin-top: auto; display: flex; flex-direction: column; gap: 4px; }

    /* ── main column ── */
    .tba-main { flex: 1; min-width: 0; height: 100%; overflow-y: auto; display: flex; flex-direction: column; }
    .tba-top { position: sticky; top: 0; z-index: 20; display: grid; grid-template-columns: 1fr auto; background: rgba(255,255,255,.94); backdrop-filter: blur(8px); border-bottom: 1px solid var(--tba-line); }
    .tba-top-left { display: flex; align-items: center; gap: 12px; padding: 18px 32px; min-width: 0; }
    .tba-top-right { display: flex; align-items: center; justify-content: flex-end; gap: 14px; padding: 18px 32px; }
    .tba.rail-mode .tba-top { grid-template-columns: 1fr var(--tba-rail); }
    .tba.rail-mode .tba-top-right { background: var(--tba-cream); }
    .tba-page { flex: 1; padding: 26px 32px 48px; }
    .tba.rail-mode .tba-page { padding: 0; display: flex; }
    .tba.rail-mode .tba-page > *:not(router-outlet) { flex: 1; }

    .tba-burger { display: none; border: 0; background: none; font-size: 24px; padding: 4px; }
    .tba-search { position: relative; flex: 1; max-width: 460px; display: flex; align-items: center; gap: 10px; color: var(--tba-muted); }
    .tba-search > ion-icon { font-size: 19px; }
    .tba-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; font-size: 14px; color: var(--tba-text); padding: 6px 0; }
    .tba-search input::placeholder { color: var(--tba-faint); }

    .tba-pop { position: absolute; top: calc(100% + 10px); background: #fff; border: 1px solid var(--tba-line); border-radius: 16px; box-shadow: 0 18px 40px rgba(29,36,32,.14); padding: 8px; z-index: 40; }
    .tba-search-pop { left: -10px; right: -10px; max-height: 380px; overflow: auto; }
    .tba-hit { display: grid; grid-template-columns: 74px 1fr; column-gap: 10px; width: 100%; border: 0; background: none; text-align: left; padding: 9px 10px; border-radius: 10px; color: var(--tba-text); }
    .tba-hit:hover { background: var(--tba-soft); }
    .tba-hit em { grid-row: span 2; align-self: center; font-style: normal; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--tba-muted); }
    .tba-hit span { font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tba-hit small { color: var(--tba-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tba-pop-empty { margin: 0; padding: 14px; color: var(--tba-muted); font-size: 13px; }

    .tba-bell-wrap { position: relative; }
    .tba-icon-btn { position: relative; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; border: 0; background: transparent; font-size: 21px; }
    .tba-icon-btn:hover { background: rgba(29,36,32,.06); }
    .tba-dot { position: absolute; top: 7px; right: 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--tba-down); border: 2px solid #fff; }
    .tba-bell-pop { right: -6px; width: 320px; max-height: 420px; overflow: auto; }
    .tba-bell-pop h4 { font-size: 13px; padding: 8px 10px 6px; }
    .tba-act { display: flex; gap: 11px; align-items: flex-start; width: 100%; padding: 9px 10px; border: 0; background: none; border-radius: 10px; text-align: left; font-size: 13px; line-height: 1.4; }
    .tba-act:hover { background: var(--tba-soft); }
    .tba-act ion-icon { font-size: 17px; margin-top: 1px; color: var(--tba-muted); }
    .tba-act small { display: block; color: var(--tba-muted); font-size: 11.5px; margin-top: 2px; }

    .tba-avatar { width: 38px; height: 38px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 13px; font-weight: 700; color: var(--tba-ink); overflow: hidden; flex: none; background: var(--tba-sand-soft); }
    .tba-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .tba-avatar.sm { width: 32px; height: 32px; font-size: 11.5px; }
    .tba-avatar.lg { width: 64px; height: 64px; font-size: 20px; }

    .tba-alert { margin: 18px 32px 0; display: flex; gap: 12px; padding: 14px 16px; border-radius: 14px; background: #fff4e5; border: 1px solid #f1d7a8; color: #6b4a12; font-size: 13px; line-height: 1.5; }
    .tba-alert ion-icon { font-size: 20px; margin-top: 1px; }
    .tba-alert p { margin: 0; }
    .tba-alert code { background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 5px; }

    /* ── shared building blocks ── */
    .tba-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
    .tba-head h1 { font-size: 24px; font-weight: 700; }
    .tba-head p { margin: 5px 0 0; color: var(--tba-muted); font-size: 13.5px; }
    .tba-card { background: #fff; border: 1px solid var(--tba-line); border-radius: 18px; padding: 20px; }
    .tba-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 16px; }
    .tba-filter { display: flex; align-items: center; gap: 8px; padding: 0 14px; height: 40px; border: 1px solid var(--tba-line); border-radius: 999px; background: #fff; min-width: 240px; flex: 1; max-width: 360px; color: var(--tba-muted); }
    .tba-filter input { border: 0; outline: 0; flex: 1; min-width: 0; font-size: 13.5px; background: none; color: var(--tba-text); }
    .tba-chips { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--tba-soft); flex-wrap: wrap; }
    .tba-chips button { border: 0; background: none; padding: 7px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 600; color: var(--tba-muted); }
    .tba-chips button.on { background: var(--tba-ink); color: #fff; }
    .tba-chips button em { font-style: normal; opacity: .65; margin-left: 4px; }

    .tba-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 38px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--tba-line); background: #fff; font-size: 13px; font-weight: 600; white-space: nowrap; }
    .tba-btn:hover { background: var(--tba-soft); }
    .tba-btn.primary { background: var(--tba-ink); border-color: var(--tba-ink); color: #fff; }
    .tba-btn.primary:hover { background: #2f3a34; }
    .tba-btn.sand { background: var(--tba-sand); border-color: var(--tba-sand); color: var(--tba-ink); }
    .tba-btn.danger { color: var(--tba-down); border-color: #f2cfcd; }
    .tba-btn.danger:hover { background: #fdf1f0; }
    .tba-btn.danger-fill { background: var(--tba-down); border-color: var(--tba-down); color: #fff; }
    .tba-btn.sm { height: 32px; padding: 0 12px; font-size: 12px; }
    .tba-btn:disabled { opacity: .5; cursor: default; }
    .tba-btn ion-icon { font-size: 16px; }

    .tba-table-wrap { overflow-x: auto; }
    .tba-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    .tba-table th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--tba-muted); padding: 0 12px 12px; white-space: nowrap; }
    .tba-table td { padding: 12px; border-top: 1px solid var(--tba-line); vertical-align: middle; }
    .tba-table tr.click { cursor: pointer; }
    .tba-table tr.click:hover td { background: #fafaf7; }
    .tba-table .num { text-align: right; font-weight: 600; white-space: nowrap; }
    .tba-table .muted { color: var(--tba-muted); white-space: nowrap; }
    .tba-who { display: flex; align-items: center; gap: 11px; min-width: 0; }
    .tba-who b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tba-who small { display: block; color: var(--tba-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tba-thumb { width: 40px; height: 40px; border-radius: 11px; object-fit: cover; background: var(--tba-sage); flex: none; }

    .tba-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; background: var(--tba-soft); color: var(--tba-ink-2); }
    .tba-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .8; }
    .tba-badge[data-tone='green'] { background: #e8f4ec; color: #2d7a47; }
    .tba-badge[data-tone='amber'] { background: #fbf0dc; color: #9a6510; }
    .tba-badge[data-tone='red'] { background: #fbe9e8; color: #c23f3b; }
    .tba-badge[data-tone='ink'] { background: var(--tba-ink); color: #fff; }
    .tba-badge[data-tone='sand'] { background: var(--tba-sand-soft); color: #8a6127; }

    .tba-empty { text-align: center; padding: 48px 20px; color: var(--tba-muted); }
    .tba-empty ion-icon { font-size: 34px; color: var(--tba-faint); }
    .tba-empty h3 { font-size: 15px; margin: 10px 0 4px; }
    .tba-empty p { margin: 0; font-size: 13px; }

    .tba-drawer-wrap { position: fixed; inset: 0; z-index: 60; background: rgba(20,26,22,.32); display: flex; justify-content: flex-end; animation: tbaFade .15s ease; }
    .tba-drawer { width: min(460px, 100%); height: 100%; background: #fff; display: flex; flex-direction: column; box-shadow: -20px 0 50px rgba(0,0,0,.12); animation: tbaSlide .2s ease; }
    .tba-drawer > header { display: flex; align-items: flex-start; gap: 14px; padding: 22px 22px 16px; border-bottom: 1px solid var(--tba-line); }
    .tba-drawer > header h2 { font-size: 18px; font-weight: 700; }
    .tba-drawer > header p { margin: 4px 0 0; color: var(--tba-muted); font-size: 13px; }
    .tba-drawer > header .tba-icon-btn { margin-left: auto; }
    .tba-drawer-body { flex: 1; overflow-y: auto; padding: 18px 22px 24px; }
    .tba-drawer > footer { display: flex; gap: 8px; flex-wrap: wrap; padding: 16px 22px; border-top: 1px solid var(--tba-line); }
    .tba-dl { margin: 0 0 20px; display: grid; gap: 0; }
    .tba-dl > div { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px dashed var(--tba-line); font-size: 13.5px; }
    .tba-dl dt { color: var(--tba-muted); }
    .tba-dl dd { margin: 0; font-weight: 500; text-align: right; word-break: break-word; }
    .tba-section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--tba-muted); margin: 6px 0 10px; }

    .tba-modal-wrap { position: fixed; inset: 0; z-index: 80; background: rgba(20,26,22,.38); display: grid; place-items: center; padding: 20px; animation: tbaFade .15s ease; }
    .tba-modal { width: min(420px, 100%); background: #fff; border-radius: 20px; padding: 24px; box-shadow: 0 30px 70px rgba(0,0,0,.2); }
    .tba-modal h3 { font-size: 18px; font-weight: 700; }
    .tba-modal p { margin: 8px 0 18px; color: var(--tba-muted); line-height: 1.5; font-size: 13.5px; }
    .tba-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .tba-field { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--tba-ink-2); }
    .tba-input-box { height: 44px; border: 1px solid var(--tba-line); border-radius: 12px; padding: 0 14px; font-size: 14px; outline: 0; background: #fff; color: var(--tba-text); font-weight: 400; }
    .tba-input-box:focus { border-color: var(--tba-ink); }

    .tba-toasts { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 90; display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
    .tba-toast { display: flex; align-items: center; gap: 9px; background: var(--tba-ink); color: #fff; padding: 11px 18px; border-radius: 999px; font-size: 13px; font-weight: 500; box-shadow: 0 10px 30px rgba(0,0,0,.2); animation: tbaUp .2s ease; }
    .tba-toast ion-icon { font-size: 18px; color: #9fd3a9; }
    .tba-toast.error { background: #a83431; }
    .tba-toast.error ion-icon { color: #fff; }

    .tba-scrim { display: none; }
    @keyframes tbaFade { from { opacity: 0; } }
    @keyframes tbaSlide { from { transform: translateX(30px); opacity: .4; } }
    @keyframes tbaUp { from { transform: translateY(10px); opacity: 0; } }

    @media (max-width: 1199px) {
      .tba.rail-mode .tba-top { grid-template-columns: 1fr auto; }
      .tba.rail-mode .tba-top-right { background: none; }
    }
    @media (max-width: 899px) {
      .tba-side { position: fixed; left: 0; top: 0; bottom: 0; transform: translateX(-100%); transition: transform .22s ease; visibility: hidden; }
      .tba.nav-open .tba-side { transform: none; visibility: visible; box-shadow: 20px 0 50px rgba(0,0,0,.1); }
      .tba.nav-open .tba-scrim { display: block; position: fixed; inset: 0; z-index: 25; background: rgba(20,26,22,.3); }
      .tba-burger { display: grid; }
      .tba-top-left, .tba-top-right { padding: 14px 16px; }
      .tba-page { padding: 18px 16px 40px; }
      .tba-alert { margin: 14px 16px 0; }
      .tba-filter { min-width: 0; max-width: none; }
      .tba .hide-sm { display: none; }
    }
  `],
})
export class AdminShellComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AdminAuthService);
  private readonly router = inject(Router);
  readonly data = inject(AdminDataService);
  readonly ui = inject(AdminUiService);

  readonly admin = this.auth.admin;
  readonly navOpen = signal(false);
  readonly railMode = signal(false);

  readonly term = signal('');
  readonly searchOpen = signal(false);
  readonly bellOpen = signal(false);
  private readonly seenAt = signal(readSeen());

  readonly nav: NavItem[] = [
    { path: '/admin', label: 'Dashboard', icon: 'grid-outline', exact: true },
    { path: '/admin/bookings', label: 'Bookings', icon: 'receipt-outline' },
    { path: '/admin/hikers', label: 'Hikers', icon: 'people-outline' },
    { path: '/admin/trails', label: 'Trails', icon: 'trail-sign-outline' },
    { path: '/admin/community', label: 'Community', icon: 'chatbubbles-outline' },
    { path: '/admin/reviews', label: 'Reviews', icon: 'star-outline' },
    { path: '/admin/certificates', label: 'Certificates', icon: 'document-attach-outline', badge: () => this.data.pendingCertificates() },
    { path: '/admin/packages', label: 'Packages', icon: 'pricetags-outline' },
    { path: '/admin/settings', label: 'Settings', icon: 'settings-outline' },
  ];

  private readonly trails = allTrails();
  private sub?: Subscription;

  readonly hits = computed<SearchHit[]>(() => {
    const q = this.term().trim();
    if (q.length < 2) return [];
    const out: SearchHit[] = [];
    for (const u of this.data.users()) {
      if (matches(q, u.name, u.email, u.phone)) {
        out.push({ kind: 'Hiker', label: u.name || u.email || 'Unnamed hiker', sub: u.email, path: '/admin/hikers', open: u.uid });
      }
    }
    for (const b of this.data.bookings()) {
      if (matches(q, b.reference, b.trailName, b.userName, b.userEmail)) {
        out.push({ kind: 'Booking', label: `#${b.reference} · ${b.trailName}`, sub: b.userName || b.userEmail || '—', path: '/admin/bookings', open: b.id });
      }
    }
    for (const t of this.trails) {
      if (matches(q, t.name, t.region)) {
        out.push({ kind: 'Trail', label: t.name, sub: t.region, path: '/admin/trails', open: t.id });
      }
    }
    for (const p of this.data.posts()) {
      if (matches(q, p.text, p.authorName)) {
        out.push({ kind: 'Post', label: p.text.slice(0, 60) || '(photo post)', sub: p.authorName, path: '/admin/community', open: p.id });
      }
    }
    return out.slice(0, 12);
  });

  readonly activity = computed<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];
    for (const b of this.data.bookings().slice(0, 15)) {
      if (!b.createdAt) continue;
      const who = b.userName || 'A hiker';
      items.push({
        at: b.createdAt, icon: 'receipt-outline', path: '/admin/bookings', open: b.id,
        text: b.status === 'cancelled' ? `Booking #${b.reference} was cancelled` : `${who} booked ${b.trailName}`,
      });
    }
    for (const p of this.data.posts().slice(0, 15)) {
      if (!p.createdAt) continue;
      items.push({
        at: p.createdAt, icon: 'chatbubbles-outline', path: '/admin/community', open: p.id,
        text: p.repostOf ? `${p.authorName} reposted a post` : `${p.authorName} posted in Community`,
      });
    }
    for (const r of this.data.reviews().slice(0, 15)) {
      if (!r.createdAt) continue;
      items.push({
        at: r.createdAt, icon: 'star-outline', path: '/admin/reviews', open: r.id,
        text: `${r.author} rated ${r.trailName} ${r.rating}★`,
      });
    }
    for (const c of this.data.certificates().slice(0, 15)) {
      if (!c.uploadedAt) continue;
      const who = this.data.userById(c.uid)?.name || c.userName || 'A hiker';
      items.push({
        at: c.uploadedAt, icon: 'document-attach-outline', path: '/admin/certificates', open: c.id,
        text: `${who} uploaded a ${c.type === 'medical' ? 'medical certificate' : 'barangay clearance'}`,
      });
    }
    return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 10);
  });

  readonly unseen = computed(() => this.activity().some((a) => a.at.getTime() > this.seenAt()));

  constructor() {
    addIcons({
      chatbubblesOutline, closeOutline, gridOutline, logOutOutline, menuOutline, notificationsOutline,
      peopleOutline, phonePortraitOutline, pricetagsOutline, receiptOutline, searchOutline,
      settingsOutline, starOutline, trailSignOutline, alertCircleOutline, checkmarkCircle,
      documentAttachOutline,
    });
  }

  ngOnInit(): void {
    this.data.start();
    this.railMode.set(isDashboard(this.router.url));
    this.sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.railMode.set(isDashboard(e.urlAfterRedirects));
        this.searchOpen.set(false);
        this.bellOpen.set(false);
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  go(h: { path: string; open: string }): void {
    this.searchOpen.set(false);
    this.term.set('');
    this.router.navigate([h.path], { queryParams: { open: h.open } });
  }

  goFirst(): void {
    const first = this.hits()[0];
    if (first) this.go(first);
  }

  onSearchBlur(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (!next || !(e.currentTarget as HTMLElement).contains(next)) this.searchOpen.set(false);
  }

  toggleBell(): void {
    const open = !this.bellOpen();
    this.bellOpen.set(open);
    if (open) {
      const now = Date.now();
      this.seenAt.set(now);
      try { localStorage.setItem(SEEN_KEY, String(now)); } catch { /* private mode */ }
    }
  }

  onBellBlur(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (!next || !(e.currentTarget as HTMLElement).contains(next)) this.bellOpen.set(false);
  }

  openActivity(a: ActivityItem): void {
    this.bellOpen.set(false);
    this.router.navigate([a.path], { queryParams: { open: a.open } });
  }

  async signOut(): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'Log out?',
      message: 'You will need your username and password to get back in.',
      confirmText: 'Log out',
    });
    if (!ok) return;
    this.data.stop();
    await this.auth.signOut();
    this.router.navigateByUrl('/admin/login', { replaceUrl: true });
  }

  ago = timeAgo;
  initialsOf = initials;
  tint = tintFor;
}

function isDashboard(url: string): boolean {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  return path === '/admin';
}

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
