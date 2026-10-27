import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { IonFab, IonFabButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chatbubbleEllipses } from 'ionicons/icons';
import { filter } from 'rxjs';
import { ChatModalComponent } from './chat-modal.component';

/** Routes where the assistant button is hidden (auth screens and staff areas). */
const HIDDEN_ON = ['/login', '/signup', '/admin', '/office', '/guide'];

@Component({
  selector: 'app-chat-fab',
  standalone: true,
  imports: [IonFab, IonFabButton, IonIcon],
  template: `
    @if (!hidden()) {
      <ion-fab [class.off-tabs]="!onTabs()">
        <ion-fab-button (click)="open()" aria-label="Open the TrailBound assistant">
          <ion-icon name="chatbubble-ellipses"></ion-icon>
        </ion-fab-button>
      </ion-fab>
    }
  `,
  styles: [
    `
      /* Mounted at the app root, so it is pinned to the viewport instead of ion-content.
         Tune the offsets in global.scss: app-chat-fab { --chat-fab-bottom: 90px; } */
      ion-fab {
        position: fixed;
        right: 16px;
        bottom: calc(var(--chat-fab-bottom, 84px) + env(safe-area-inset-bottom));
        z-index: 100;
      }
      /* Pages without the tab bar usually have a bottom action bar (like Book Now). */
      ion-fab.off-tabs {
        bottom: calc(var(--chat-fab-bottom-offtabs, 96px) + env(safe-area-inset-bottom));
      }
      ion-fab-button {
        --background: var(--chat-accent, #e8d99c);
        --background-activated: var(--chat-accent, #e8d99c);
        --background-hover: var(--chat-accent, #e8d99c);
        --color: var(--chat-accent-contrast, #1b1808);
        --box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
      }
    `,
  ],
})
export class ChatFabComponent {
  private modalCtrl = inject(ModalController);
  private router = inject(Router);

  private url = signal(this.router.url);
  readonly hidden = computed(() => HIDDEN_ON.some((p) => this.url().startsWith(p)));
  readonly onTabs = computed(() => this.url().startsWith('/tabs'));

  private opening = false;

  constructor() {
    addIcons({ chatbubbleEllipses });

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => this.url.set(e.urlAfterRedirects));
  }

  async open() {
    if (this.opening) return;
    this.opening = true;
    try {
      const modal = await this.modalCtrl.create({
        component: ChatModalComponent,
        breakpoints: [0, 0.6, 1],
        initialBreakpoint: 0.6,
        handle: true,
        cssClass: 'chat-sheet',
      });
      // Match the app's dark page color and rounded sheet corners.
      modal.style.setProperty('--background', 'var(--chat-bg, #0b1210)');
      modal.style.setProperty('--border-radius', '24px');
      await modal.present();
    } finally {
      this.opening = false;
    }
  }
}
