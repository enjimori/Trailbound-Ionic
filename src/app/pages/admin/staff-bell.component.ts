/**
 * The notification bell in the staff top bars — the admin shell, and the
 * shared shell /guide and /office use. One component so all three behave the
 * same: an unread count, a panel of notifications, "Mark all read", and a tap
 * that marks one read and opens it.
 *
 * It only draws. Each shell hands it its own feed (AdminNotificationsService,
 * GuideNotificationsService or OfficeNotificationsService) and decides what a
 * tap does.
 *
 * Styling lives in admin-ui.css and admin-dark.css under .tba, like every other
 * staff building block, so it follows each shell's light / dark switch.
 */
import { Component, EventEmitter, Input, OnDestroy, Output, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alarmOutline, alertCircleOutline, calendarOutline, cardOutline, chatbubblesOutline,
  checkmarkCircleOutline, closeCircleOutline, documentAttachOutline, flagOutline,
  hourglassOutline, notificationsOutline, peopleOutline, personAddOutline, receiptOutline, ribbonOutline, starOutline,
} from 'ionicons/icons';
import { Subscription, filter } from 'rxjs';
import type { AppNotification } from '../../models/notification.model';

@Component({
  selector: 'app-staff-bell',
  standalone: true,
  imports: [IonIcon],
  template: `
    <div class="tba-bell-wrap" (focusout)="onBlur($event)" (keydown.escape)="open.set(false)">
      <button
        type="button"
        class="tba-icon-btn"
        [attr.aria-label]="unread ? 'Notifications, ' + unread + ' unread' : 'Notifications'"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <ion-icon name="notifications-outline"></ion-icon>
        @if (unread) { <i class="tba-bell-count">{{ unread > 9 ? '9+' : unread }}</i> }
      </button>

      @if (open()) {
        <!-- mousedown is cancelled so a tap inside never blurs the bell and
             closes the panel before the click lands (Safari does not focus
             buttons on click). -->
        <div class="tba-pop tba-bell-pop" role="dialog" [attr.aria-label]="heading" (mousedown)="$event.preventDefault()">
          <div class="tba-bell-head">
            <h4>{{ heading }}</h4>
            @if (unread) {
              <button type="button" class="tba-bell-mark" (click)="markAll.emit()">Mark all read</button>
            }
          </div>

          @for (n of items; track n.id) {
            <button type="button" class="tba-act tba-note" [class.unread]="!n.read" (click)="pick(n)">
              <span class="tba-note-icon" [attr.data-tone]="n.tone || 'accent'">
                <ion-icon [name]="n.icon"></ion-icon>
              </span>
              <span class="tba-note-body">
                <b>{{ n.title }}</b>
                <span>{{ n.message }}</span>
                <small>{{ n.time }}</small>
              </span>
              @if (!n.read) { <i class="tba-note-dot" aria-label="Unread"></i> }
            </button>
          } @empty {
            <p class="tba-pop-empty">{{ empty }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class StaffBellComponent implements OnDestroy {
  @Input() items: AppNotification[] = [];
  @Input() unread = 0;
  @Input() heading = 'Notifications';
  @Input() empty = 'Nothing new yet.';

  /** A notification was tapped. The panel has already closed. */
  @Output() pickNote = new EventEmitter<AppNotification>();
  @Output() markAll = new EventEmitter<void>();

  readonly open = signal(false);
  private readonly sub: Subscription;

  constructor() {
    // Every icon the admin, guide and office feeds use, so the panel never
    // shows a blank icon whichever feed registered first.
    addIcons({
      alarmOutline, alertCircleOutline, calendarOutline, cardOutline, chatbubblesOutline,
      checkmarkCircleOutline, closeCircleOutline, documentAttachOutline, flagOutline,
      hourglassOutline, notificationsOutline, peopleOutline, personAddOutline, receiptOutline, ribbonOutline, starOutline,
    });
    // Close on navigation, as the old activity panel did.
    this.sub = inject(Router).events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.open.set(false));
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  pick(n: AppNotification): void {
    this.open.set(false);
    this.pickNote.emit(n);
  }

  /** Closes the panel when focus moves somewhere outside it. */
  onBlur(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (!next || !(e.currentTarget as HTMLElement).contains(next)) this.open.set(false);
  }
}
