export type NotificationType = 'weather' | 'tip' | 'maintenance' | 'social';

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
}
