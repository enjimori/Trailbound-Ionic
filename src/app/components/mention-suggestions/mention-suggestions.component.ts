import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { person } from 'ionicons/icons';
import { PersonSummary } from '../../services/follow.service';

/** The little list that appears above the text box while typing "@name". */
@Component({
  selector: 'app-mention-suggestions',
  standalone: true,
  imports: [CommonModule, IonIcon],
  template: `
    <div class="mention-list" *ngIf="people.length" role="listbox" aria-label="Mention someone">
      <!-- mousedown (not click) so the text box keeps focus and its caret -->
      <button
        type="button"
        class="mention-row"
        role="option"
        *ngFor="let p of people"
        (mousedown)="$event.preventDefault(); pick.emit(p)"
        (touchstart)="$event.preventDefault(); pick.emit(p)"
      >
        <img *ngIf="p.avatar; else none" class="m-avatar" [src]="p.avatar" alt="" />
        <ng-template #none><span class="m-avatar default"><ion-icon name="person"></ion-icon></span></ng-template>
        <span class="m-name">{{ p.name }}</span>
      </button>
    </div>
  `,
  styles: [`
    .mention-list {
      display: flex; flex-direction: column;
      margin: 0 0 6px; padding: 4px;
      background: var(--app-bg-raised);
      border: 1px solid var(--app-border-strong);
      border-radius: 14px;
      max-height: 220px; overflow-y: auto;
    }
    .mention-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border: none; border-radius: 10px;
      background: none; color: var(--app-text);
      font: inherit; font-size: 13.5px; text-align: left;
    }
    .mention-row:active { background: var(--app-card-hi); }
    .m-avatar {
      width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; object-fit: cover;
      background: var(--app-card-hi); border: 1px solid var(--app-border);
    }
    .m-avatar.default { display: flex; align-items: center; justify-content: center; font-size: 15px; color: var(--app-text-dim); }
    .m-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `],
})
export class MentionSuggestionsComponent {
  @Input() people: PersonSummary[] = [];
  @Output() pick = new EventEmitter<PersonSummary>();

  constructor() {
    addIcons({ person });
  }
}
