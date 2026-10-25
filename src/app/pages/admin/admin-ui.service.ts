/**
 * Toasts and confirm dialogs for the admin panel. The shell draws them;
 * pages just call toast() or await confirm().
 */
import { Injectable, signal } from '@angular/core';

export interface AdminToast {
  id: number;
  message: string;
  tone: 'ok' | 'error';
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  /** Optional text box, e.g. a reason for closing a trail. */
  input?: { label: string; placeholder?: string; value?: string };
}

export interface ConfirmState extends ConfirmOptions {
  value: string;
  resolve: (result: string | null) => void;
}

@Injectable({ providedIn: 'root' })
export class AdminUiService {
  readonly toasts = signal<AdminToast[]>([]);
  readonly dialog = signal<ConfirmState | null>(null);
  private nextId = 1;

  /** Shows a brief Ionic notification so the user can understand the action result. */
  toast(message: string, tone: AdminToast['tone'] = 'ok'): void {
    const id = this.nextId++;
    this.toasts.update((t) => [...t, { id, message, tone }]);
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), 3200);
  }

  /** Shows a friendly message for a failed Firestore write. */
  fail(err: unknown, fallback = 'That did not work. Please try again.'): void {
    const code = (err as { code?: string })?.code ?? '';
    const msg =
      code === 'permission-denied'
        ? 'Firebase refused that change. Publish the new firestore.rules (see README).'
        : code === 'unavailable'
          ? 'You appear to be offline.'
          : fallback;
    console.error('[admin]', err);
    this.toast(msg, 'error');
  }

  /** Resolves true when confirmed. */
  async confirm(opts: ConfirmOptions): Promise<boolean> {
    return (await this.ask(opts)) !== null;
  }

  /** Resolves with the typed text, or null when cancelled. */
  ask(opts: ConfirmOptions): Promise<string | null> {
    return new Promise((resolve) => {
      this.dialog.set({ ...opts, value: opts.input?.value ?? '', resolve });
    });
  }

  /** Closes the active view and restores the surrounding page state. */
  close(result: string | null): void {
    const d = this.dialog();
    if (!d) return;
    this.dialog.set(null);
    d.resolve(result);
  }
}
