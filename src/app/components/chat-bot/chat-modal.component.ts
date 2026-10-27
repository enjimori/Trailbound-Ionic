import {
  Component,
  ElementRef,
  Pipe,
  PipeTransform,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  IonButton,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  addOutline,
  arrowUp,
  chatbubbleOutline,
  closeOutline,
  leafOutline,
  timeOutline,
  trashOutline,
} from 'ionicons/icons';
import { ChatService, Conversation } from '../../services/chat.service';

interface Part {
  text: string;
  bold: boolean;
}
interface Block {
  kind: 'p' | 'li';
  parts: Part[];
}

/** Turns the model's light markdown (bold and bullets) into safe blocks, without using innerHTML. */
@Pipe({ name: 'chatFormat', standalone: true })
export class ChatFormatPipe implements PipeTransform {
  transform(text: string): Block[] {
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line): Block => {
        const bullet = /^[*\-•]\s+(.*)$/.exec(line);
        const body = (bullet ? bullet[1] : line).replace(/^#+\s*/, '');
        const parts: Part[] = body
          .split(/\*\*(.+?)\*\*/g)
          .map((chunk, i): Part => ({ text: chunk, bold: i % 2 === 1 }))
          .filter((p) => p.text);
        return { kind: bullet ? 'li' : 'p', parts };
      });
  }
}

@Component({
  selector: 'app-chat-modal',
  standalone: true,
  imports: [IonHeader, IonToolbar, IonButton, IonIcon, IonContent, IonFooter, ChatFormatPipe],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <div class="head">
          <span class="avatar" aria-hidden="true"><ion-icon name="leaf-outline"></ion-icon></span>
          <div class="titles">
            <h2>{{ view() === 'chat' ? 'TrailBound Assistant' : 'Your chats' }}</h2>
            <p>{{ view() === 'chat' ? 'Trails, bookings and app help' : 'Pick up where you left off' }}</p>
          </div>
          <ion-button
            fill="clear"
            size="small"
            (click)="toggleHistory()"
            [attr.aria-label]="view() === 'chat' ? 'Show my chats' : 'Back to chat'"
          >
            <ion-icon slot="icon-only" [name]="view() === 'chat' ? 'time-outline' : 'chatbubble-outline'"></ion-icon>
          </ion-button>
          <ion-button fill="clear" size="small" (click)="startNew()" aria-label="Start a new chat">
            <ion-icon slot="icon-only" name="add-outline"></ion-icon>
          </ion-button>
          <ion-button fill="clear" size="small" (click)="close()" aria-label="Close chat">
            <ion-icon slot="icon-only" name="close-outline"></ion-icon>
          </ion-button>
        </div>
      </ion-toolbar>
    </ion-header>

    <ion-content #content class="ion-padding-horizontal">
      @if (view() === 'history') {
        <div class="history">
          <button type="button" class="new" (click)="startNew()">
            <ion-icon name="add-outline"></ion-icon> New chat
          </button>

          @for (c of chat.savedChats(); track c.id) {
            <div class="item" [class.active]="c.id === chat.activeId()">
              <button type="button" class="open" (click)="open(c.id)">
                <span class="t">{{ c.title || 'New chat' }}</span>
                <span class="s">{{ preview(c) }} · {{ when(c.updatedAt) }}</span>
              </button>
              <button
                type="button"
                class="del"
                [class.confirm]="confirmId() === c.id"
                (click)="askDelete(c.id)"
                [attr.aria-label]="confirmId() === c.id ? 'Tap again to delete this chat' : 'Delete this chat'"
              >
                @if (confirmId() === c.id) {
                  Delete?
                } @else {
                  <ion-icon name="trash-outline"></ion-icon>
                }
              </button>
            </div>
          } @empty {
            <p class="empty">No saved chats yet. Ask something and it will show up here.</p>
          }
        </div>
      } @else {
        <div class="thread" role="log" aria-live="polite" aria-relevant="additions">
          @for (m of chat.messages(); track $index) {
            @if (m.role === 'user') {
              <div class="row user"><div class="bubble user">{{ m.text }}</div></div>
            } @else {
              <div class="row">
                <div class="bubble" [class.error]="m.error">
                  @for (b of m.text | chatFormat; track $index) {
                    @if (b.kind === 'li') {
                      <div class="li">
                        <span class="dot" aria-hidden="true">•</span>
                        <span>
                          @for (p of b.parts; track $index) {
                            @if (p.bold) {
                              <strong>{{ p.text }}</strong>
                            } @else {
                              <span>{{ p.text }}</span>
                            }
                          }
                        </span>
                      </div>
                    } @else {
                      <p>
                        @for (p of b.parts; track $index) {
                          @if (p.bold) {
                            <strong>{{ p.text }}</strong>
                          } @else {
                            <span>{{ p.text }}</span>
                          }
                        }
                      </p>
                    }
                  }
                  @if (m.error && $last && !chat.loading()) {
                    <button type="button" class="retry" (click)="chat.retry()">Try again</button>
                  }
                </div>
              </div>
            }
          }

          @if (chat.waiting()) {
            <div class="row">
              <div class="bubble typing" aria-label="Assistant is typing">
                <span class="d"></span><span class="d"></span><span class="d"></span>
              </div>
            </div>
          }

          @if (showSuggestions()) {
            <div class="chips">
              @for (s of chat.suggestions.slice(0, 4); track s) {
                <button type="button" class="chip" (click)="chat.send(s)">{{ s }}</button>
              }
            </div>
          }
        </div>
      }
    </ion-content>

    @if (view() === 'chat') {
      <ion-footer class="ion-no-border">
        @if (chat.messages().length > 1 && chat.remainingSuggestions().length) {
          <div class="strip" role="group" aria-label="Suggested questions">
            @for (s of chat.remainingSuggestions(); track s) {
              <button type="button" class="chip" [disabled]="chat.loading()" (click)="chat.send(s)">{{ s }}</button>
            }
          </div>
        }
        <form class="composer" (submit)="submit($event)">
          <div class="field">
            <textarea
              #input
              rows="1"
              maxlength="1000"
              placeholder="Ask about trails or the app"
              aria-label="Message"
              [value]="draft()"
              (input)="onInput(input)"
              (keydown.enter)="onEnter($event)"
            ></textarea>
            <button
              type="submit"
              class="send"
              [disabled]="!draft().trim() || chat.loading()"
              aria-label="Send message"
            >
              <ion-icon name="arrow-up"></ion-icon>
            </button>
          </div>
          <p class="note">AI can make mistakes. In an emergency, contact local emergency services.</p>
        </form>
      </ion-footer>
    }
  `,
  styles: [
    `
      /* Design tokens sampled from the app: deep green-black page (#0b1210), card surface (#131d19),
         warm gold accent (#e8d99c). Override from global.scss, e.g.
         app-chat-modal { --chat-accent: #e8d99c; --chat-bg: #0b1210; --chat-heading-font: 'Lora', serif; } */

      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--chat-bg, #0b1210);
        color: var(--chat-text, #f3f1ea);
      }
      ion-header, ion-footer { flex: none; }
      ion-content {
        --background: var(--chat-bg, #0b1210);
        flex: 1;
        min-height: 0;
      }
      ion-footer { background: var(--chat-bg, #0b1210); }
      ion-toolbar {
        --background: transparent;
        --border-width: 0;
        --padding-start: 18px;
        --padding-end: 8px;
        --padding-top: 8px;
        --padding-bottom: 8px;
      }
      ion-toolbar ion-button { --color: var(--chat-muted, rgba(243, 241, 234, 0.62)); }

      .head { display: flex; align-items: center; gap: 4px; width: 100%; }
      .avatar {
        flex: none;
        width: 40px;
        height: 40px;
        margin-right: 8px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        font-size: 21px;
        color: var(--chat-accent, #e8d99c);
        background: color-mix(in srgb, var(--chat-accent, #e8d99c) 16%, var(--chat-bg, #0b1210));
      }
      .titles { flex: 1; min-width: 0; }
      .titles h2 {
        margin: 0;
        font-family: var(--chat-heading-font, 'Lora', Georgia, 'Times New Roman', serif);
        font-size: 19px;
        font-weight: 600;
        line-height: 1.2;
        color: var(--chat-text, #f3f1ea);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .titles p { margin: 2px 0 0; font-size: 12px; color: var(--chat-muted, rgba(243, 241, 234, 0.62)); }

      .thread { display: flex; flex-direction: column; gap: 10px; padding: 8px 0 16px; }
      .row { display: flex; }
      .row.user { justify-content: flex-end; }

      .bubble {
        max-width: 88%;
        padding: 11px 15px;
        border-radius: 18px 18px 18px 6px;
        background: var(--chat-surface, #131d19);
        border: 1px solid var(--chat-border, rgba(255, 255, 255, 0.09));
        color: var(--chat-text, #f3f1ea);
        font-size: 15px;
        line-height: 1.5;
        overflow-wrap: anywhere;
      }
      .bubble.user {
        border-radius: 18px 18px 6px 18px;
        background: var(--chat-accent, #e8d99c);
        border-color: transparent;
        color: var(--chat-accent-contrast, #1b1808);
        white-space: pre-wrap;
      }
      .bubble.error { border-color: var(--chat-danger, #f08a7e); }
      .bubble strong { font-weight: 600; }
      .bubble p { margin: 0; }
      .bubble p + p, .bubble p + .li, .bubble .li + p { margin-top: 8px; }
      .li { display: flex; gap: 8px; margin-top: 4px; }
      .li .dot { color: var(--chat-accent, #e8d99c); }

      .retry {
        margin-top: 10px;
        min-height: 38px;
        padding: 6px 18px;
        border-radius: 999px;
        border: 1px solid var(--chat-accent, #e8d99c);
        background: transparent;
        color: var(--chat-accent, #e8d99c);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }

      .typing { display: flex; gap: 5px; padding: 15px 16px; }
      .d {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--chat-accent, #e8d99c);
        animation: bounce 1.2s infinite ease-in-out;
      }
      .d:nth-child(2) { animation-delay: 0.15s; }
      .d:nth-child(3) { animation-delay: 0.3s; }
      @keyframes bounce {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
        30% { transform: translateY(-4px); opacity: 1; }
      }
      @media (prefers-reduced-motion: reduce) {
        .d { animation: none; opacity: 0.7; }
      }

      /* Pills like the Nearby / Popular / Scenic chips on the home page */
      .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
      .chip {
        min-height: 42px;
        padding: 9px 16px;
        border-radius: 999px;
        border: 1px solid var(--chat-border, rgba(255, 255, 255, 0.12));
        background: var(--chat-surface, #131d19);
        color: var(--chat-text, #f3f1ea);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .chip:active { border-color: var(--chat-accent, #e8d99c); }
      .chip:disabled { opacity: 0.45; cursor: default; }

      /* Premade questions that stay available above the input once the chat has started */
      .strip {
        display: flex;
        gap: 8px;
        padding: 6px 14px 2px;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .strip::-webkit-scrollbar { display: none; }
      .strip .chip { flex: none; min-height: 36px; padding: 6px 14px; white-space: nowrap; }

      /* Saved chats list */
      .history { display: flex; flex-direction: column; gap: 8px; padding: 8px 0 16px; }
      .new {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 46px;
        border-radius: 14px;
        border: 1px dashed var(--chat-accent, #e8d99c);
        background: transparent;
        color: var(--chat-accent, #e8d99c);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .item {
        display: flex;
        align-items: stretch;
        border-radius: 14px;
        background: var(--chat-surface, #131d19);
        border: 1px solid var(--chat-border, rgba(255, 255, 255, 0.09));
        overflow: hidden;
      }
      .item.active { border-color: var(--chat-accent, #e8d99c); }
      .open {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 12px 14px;
        border: 0;
        background: transparent;
        color: var(--chat-text, #f3f1ea);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .open .t {
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .open .s {
        font-size: 12px;
        color: var(--chat-muted, rgba(243, 241, 234, 0.62));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .del {
        flex: none;
        min-width: 52px;
        padding: 0 12px;
        border: 0;
        border-left: 1px solid var(--chat-border, rgba(255, 255, 255, 0.09));
        background: transparent;
        color: var(--chat-muted, rgba(243, 241, 234, 0.62));
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .del ion-icon { font-size: 18px; }
      .del.confirm { color: var(--chat-danger, #f08a7e); }
      .empty { margin: 24px 8px; text-align: center; font-size: 14px; color: var(--chat-muted, rgba(243, 241, 234, 0.62)); }

      /* Input styled like the home page search bar */
      .composer { padding: 8px 14px calc(10px + env(safe-area-inset-bottom)); }
      .field {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 6px 6px 6px 18px;
        border-radius: 22px;
        background: var(--chat-surface, #131d19);
        border: 1px solid var(--chat-border, rgba(255, 255, 255, 0.12));
      }
      .field:focus-within { border-color: var(--chat-accent, #e8d99c); }
      textarea {
        flex: 1;
        min-width: 0;
        max-height: 120px;
        padding: 10px 0;
        border: 0;
        outline: 0;
        resize: none;
        background: transparent;
        color: var(--chat-text, #f3f1ea);
        font: inherit;
        font-size: 15px;
        line-height: 1.4;
      }
      textarea::placeholder { color: var(--chat-muted, rgba(243, 241, 234, 0.55)); }
      .send {
        flex: none;
        width: 42px;
        height: 42px;
        border: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 20px;
        cursor: pointer;
        background: var(--chat-accent, #e8d99c);
        color: var(--chat-accent-contrast, #1b1808);
      }
      .send:disabled { opacity: 0.35; cursor: default; }
      .note { margin: 8px 8px 0; text-align: center; font-size: 11px; color: var(--chat-muted, rgba(243, 241, 234, 0.55)); }
    `,
  ],
})
export class ChatModalComponent {
  readonly chat = inject(ChatService);
  private modalCtrl = inject(ModalController);

  readonly draft = signal('');
  readonly view = signal<'chat' | 'history'>('chat');
  /** The chat whose bin was tapped once; a second tap deletes it. */
  readonly confirmId = signal<string | null>(null);
  readonly showSuggestions = computed(() => this.chat.messages().length === 1 && !this.chat.loading());

  private content = viewChild<IonContent>('content');
  private input = viewChild<ElementRef<HTMLTextAreaElement>>('input');

  constructor() {
    addIcons({ addOutline, arrowUp, chatbubbleOutline, closeOutline, leafOutline, timeOutline, trashOutline });

    // Keep the newest message in view.
    effect(() => {
      this.chat.messages();
      this.chat.loading();
      if (this.view() !== 'chat') return;
      const ms = this.chat.loading() ? 0 : 200; // no animation while text streams in
      setTimeout(() => this.content()?.scrollToBottom(ms), 0);
    });
  }

  // ---------- Chat list ----------

  toggleHistory() {
    this.confirmId.set(null);
    this.view.update((v) => (v === 'chat' ? 'history' : 'chat'));
  }

  startNew() {
    this.chat.newChat();
    this.confirmId.set(null);
    this.draft.set('');
    this.view.set('chat');
  }

  open(id: string) {
    this.chat.switchTo(id);
    this.confirmId.set(null);
    this.view.set('chat');
  }

  askDelete(id: string) {
    if (this.confirmId() === id) {
      this.chat.remove(id);
      this.confirmId.set(null);
    } else {
      this.confirmId.set(id);
    }
  }

  preview(c: Conversation): string {
    const last = c.messages[c.messages.length - 1];
    const t = (last?.text ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    return t.length > 50 ? `${t.slice(0, 50).trimEnd()}…` : t;
  }

  when(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // ---------- Composer ----------

  onInput(el: HTMLTextAreaElement) {
    this.draft.set(el.value);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  onEnter(e: Event) {
    if ((e as KeyboardEvent).shiftKey) return; // Shift+Enter = new line
    e.preventDefault();
    this.submit();
  }

  submit(e?: Event) {
    e?.preventDefault();
    const text = this.draft();
    if (!text.trim() || this.chat.loading()) return;
    this.draft.set('');
    const el = this.input()?.nativeElement;
    if (el) el.style.height = 'auto';
    void this.chat.send(text);
  }

  close() {
    return this.modalCtrl.dismiss();
  }
}
