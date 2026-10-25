import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MentionRef, toSegments } from '../../services/mention.util';

/** Shows post or comment text with tappable @mentions. Plain text stays plain (no innerHTML). */
@Component({
  selector: 'app-mention-text',
  standalone: true,
  imports: [CommonModule],
  template: `<ng-container *ngFor="let s of segments"><button
      *ngIf="s.uid; else plain" type="button" class="mention" (click)="openUser.emit(s.uid!)">{{ s.text }}</button><ng-template #plain>{{ s.text }}</ng-template></ng-container>`,
  styles: [`
    :host { white-space: pre-line; }
    .mention {
      display: inline; padding: 0; border: none; background: none;
      font: inherit; font-weight: 600; color: var(--app-accent); cursor: pointer;
    }
  `],
})
export class MentionTextComponent {
  @Input() text = '';
  @Input() mentions: MentionRef[] | undefined;
  @Output() openUser = new EventEmitter<string>();

  /** Splits the text into plain-text and mention segments for styled rendering. */
  get segments() {
    return toSegments(this.text, this.mentions);
  }
}
