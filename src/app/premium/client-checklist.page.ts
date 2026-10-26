/**
 * /client-checklist?f=…&t=…&c=…&trail=…&date=…&n=…&by=…
 *
 * The page a facilitator's client opens from the link they were sent
 * (TrailBound Facilitator MLP). The client ticks off the gear list for the
 * trail. Ticks are kept on the device; once the client is signed in, the
 * progress (items ticked, total, completed time — nothing else) is written to
 * the client's own profile so the facilitator sees who is ready.
 *
 * Public: anyone with the link can open it; sending progress needs sign-in.
 */
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmark, checkmarkCircleOutline, cloudDoneOutline, logInOutline } from 'ionicons/icons';
import { arrayUnion, doc, setDoc } from 'firebase/firestore';

import { auth, db } from '../services/firebase.client';
import { UserService } from '../services/user.service';
import { CatalogService } from '../services/catalog.service';
import { TrailService } from '../services/trail.service';
import { Difficulty } from '../models/trail.model';
import { gearFor } from './prepare-hike.component';
import { RemoteChecklist, remoteKey } from './facilitator.service';
import { findTrail, readLocal, writeLocal } from './premium';

@Component({
  selector: 'app-client-checklist',
  standalone: true,
  imports: [CommonModule, IonContent, IonIcon],
  template: `
    <ion-content [fullscreen]="true">
      <div class="cc">
        <ng-container *ngIf="valid; else broken">
          <p class="cc-eyebrow">Hike checklist from {{ by }}</p>
          <h1>{{ name ? 'Hi ' + name + '!' : 'Get ready to hike' }}</h1>
          <p class="cc-sub">{{ trailName }}<ng-container *ngIf="date"> · {{ date | date: 'EEE, MMM d, y' }}</ng-container></p>

          <div class="cc-progress">
            <div class="bar"><span [style.width.%]="pct()"></span></div>
            <span>{{ doneCount() }} of {{ gear.length }} packed</span>
          </div>

          <div class="cc-ready" *ngIf="complete()">
            <ion-icon name="checkmark-circle-outline"></ion-icon>
            All packed! {{ signedIn() ? by + ' can see you are ready.' : 'Sign in below so ' + by + ' knows.' }}
          </div>

          <button type="button" class="cc-item" *ngFor="let g of gear" [class.done]="ticked().has(g.id)"
            [attr.aria-pressed]="ticked().has(g.id)" (click)="toggle(g.id)">
            <span class="box"><ion-icon name="checkmark" *ngIf="ticked().has(g.id)"></ion-icon></span>
            <span>{{ g.text }}</span>
          </button>

          <div class="cc-sync" *ngIf="signedIn(); else signIn">
            <ion-icon name="cloud-done-outline"></ion-icon>
            <span>{{ syncText() }}</span>
          </div>
          <ng-template #signIn>
            <div class="cc-sync">
              <ion-icon name="log-in-outline"></ion-icon>
              <span>Your ticks are saved on this phone. Sign in so {{ by }} can see your progress.</span>
            </div>
            <button type="button" class="cc-btn" (click)="goSignIn()">Sign in to send my progress</button>
          </ng-template>

          <p class="cc-fine">Only how many items you've ticked is shared — not your contact details.</p>
        </ng-container>

        <ng-template #broken>
          <h1>Checklist link incomplete</h1>
          <p class="cc-sub">Ask your facilitator to send the link again.</p>
        </ng-template>
      </div>
    </ion-content>
  `,
  styles: [`
    .cc { max-width: 520px; margin: 0 auto; padding: calc(28px + env(safe-area-inset-top)) 20px 48px; }
    .cc-eyebrow { margin: 0; font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--app-accent); }
    h1 { margin: 6px 0 4px; font-size: 24px; font-weight: 500; color: var(--app-text); }
    .cc-sub { margin: 0 0 16px; font-size: 13.5px; color: var(--app-text-dim); }
    .cc-progress { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: 12.5px; color: var(--app-accent); font-weight: 600; }
    .cc-progress .bar { flex: 1; height: 8px; border-radius: 999px; background: var(--app-bg-raised); overflow: hidden; }
    .cc-progress .bar span { display: block; height: 100%; background: var(--app-accent); transition: width 0.2s ease; }
    .cc-ready { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 10px 12px; border-radius: 12px; background: rgba(95, 217, 122, 0.12); color: #5fd97a; font-size: 13px; }
    .cc-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 2px; border: none; border-bottom: 1px solid var(--app-border); background: transparent; color: var(--app-text); font-size: 14px; text-align: left; }
    .cc-item.done > span:last-child { color: var(--app-text-dim); text-decoration: line-through; }
    .box { flex-shrink: 0; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 7px; border: 1.5px solid var(--app-border-strong); }
    .cc-item.done .box { background: var(--app-accent); border-color: var(--app-accent); color: var(--app-on-accent, #161d18); }
    .cc-sync { display: flex; gap: 8px; align-items: flex-start; margin-top: 16px; font-size: 12.5px; color: var(--app-text-dim); }
    .cc-sync ion-icon { flex-shrink: 0; font-size: 17px; color: var(--app-accent); }
    .cc-btn { width: 100%; min-height: 46px; margin-top: 12px; border: none; border-radius: 999px; background: var(--app-cta, #e3e6bf); color: var(--app-on-accent, #161d18); font-weight: 600; }
    .cc-fine { margin-top: 14px; font-size: 11.5px; color: var(--app-text-dim); }
  `],
})
export class ClientChecklistPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly users = inject(UserService);

  private readonly q = this.route.snapshot.queryParamMap;
  readonly f = this.q.get('f') ?? '';
  readonly t = this.q.get('t') ?? '';
  readonly c = this.q.get('c') ?? '';
  readonly trailId = this.q.get('trail') ?? '';
  readonly date = this.q.get('date') ?? '';
  readonly name = (this.q.get('n') ?? '').slice(0, 30);
  readonly by = (this.q.get('by') || 'your facilitator').slice(0, 60);
  readonly valid = !!(this.f && this.t && this.c && this.trailId);

  private readonly trail = findTrail(this.trailId, inject(CatalogService), inject(TrailService));
  readonly trailName = this.trail?.name ?? 'Your hike';
  readonly gear = gearFor((this.trail?.difficulty ?? 'Moderate') as Difficulty);

  private readonly storeKey = `trailbound.clientcheck.${this.f}.${this.t}.${this.c}`;
  readonly ticked = signal<ReadonlySet<string>>(new Set(readLocal<string[]>(this.storeKey, [])));
  readonly doneCount = computed(() => this.gear.filter((g) => this.ticked().has(g.id)).length);
  readonly pct = computed(() => (this.gear.length ? (this.doneCount() / this.gear.length) * 100 : 0));
  readonly complete = computed(() => this.gear.length > 0 && this.doneCount() === this.gear.length);
  readonly signedIn = this.users.isAuthenticated;
  readonly lastSync = signal<Date | null>(null);
  readonly syncError = signal(false);
  readonly syncText = computed(() => {
    if (this.syncError()) return `Couldn't reach ${this.by} just now — your ticks are saved and will be sent next time.`;
    const at = this.lastSync();
    return at
      ? `Progress sent to ${this.by} at ${at.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}.`
      : `Your progress is shared with ${this.by} as you tick.`;
  });

  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    addIcons({ checkmark, checkmarkCircleOutline, cloudDoneOutline, logInOutline });
    // Send what is already ticked once the sign-in state is known.
    void this.users.ready.then(() => { if (this.valid && this.signedIn()) void this.send(); });
  }

  ngOnDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      void this.send();
    }
  }

  toggle(id: string) {
    const next = new Set(this.ticked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.ticked.set(next);
    writeLocal(this.storeKey, [...next]);
    if (this.signedIn()) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.send(), 600);
    }
  }

  goSignIn() {
    void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
  }

  private async send() {
    this.timer = undefined;
    const uid = auth.currentUser?.uid;
    if (!uid || !this.valid) return;
    const entry: RemoteChecklist = {
      f: this.f,
      t: this.t,
      c: this.c,
      trailId: this.trailId,
      done: this.doneCount(),
      total: this.gear.length,
      completedAt: this.complete() ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    };
    try {
      await setDoc(doc(db, 'profiles', uid), {
        facilitatorUids: arrayUnion(this.f),
        facilitatorChecklists: { [remoteKey(this.f, this.t, this.c)]: entry },
      }, { merge: true });
      this.syncError.set(false);
      this.lastSync.set(new Date());
    } catch (e) {
      console.warn('Could not send checklist progress.', e);
      this.syncError.set(true);
    }
  }
}
