export type NotificationType =
  | 'weather' | 'tip' | 'maintenance' | 'social'
  | 'booking' | 'document' | 'permit' | 'account' | 'reminder' | 'community';

/**
 * Colour role of the icon. Templates map it to theme variables, so it reads
 * in both light and dark mode. iconColor stays as the fallback for anything
 * that sets no tone.
 */
export type NotificationTone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface AppNotification {
  id: string;
  type: NotificationType;
  icon: string;
  iconColor: string;
  title: string;
  message: string;
  /** Display text, e.g. "2h ago". */
  time: string;
  read: boolean;
  /** When it happened (ms since epoch). Used to sort the list newest-first. */
  createdAt?: number;
  /** For "someone you follow posted": the post to open when tapped. */
  postId?: string;
  /** Theme-aware icon colour. */
  tone?: NotificationTone;
  /** Where tapping it goes. */
  link?: { path: string; queryParams?: Record<string, string> };
}
