/**
 * Hiking document a hiker submits before their hike: a medical certificate.
 *
 * Firestore:
 *   certificates/{uid}_{type}        what the file is and where it stands
 *                                    (status, reviewer's note) — small, so
 *                                    the admin list loads quickly
 *   certificate_files/{uid}_{type}   the file itself, as a data URL
 *
 * Files live inside Firestore (like post photos and avatars), so no paid
 * Firebase Storage plan is needed. That is why a file is capped at about
 * 650 KB: a Firestore document holds at most 1 MiB.
 */

export type CertificateType = 'medical';
export type CertificateStatus = 'pending' | 'approved' | 'rejected';

export interface CertificateKind {
  id: CertificateType;
  title: string;
  description: string;
  icon: string;
}

export const CERTIFICATE_KINDS: CertificateKind[] = [
  {
    id: 'medical',
    title: 'Medical certificate',
    description: 'A fit-to-hike medical certificate signed by a doctor.',
    icon: 'medkit-outline',
  },
];

export function certificateKind(type: CertificateType): CertificateKind {
  return CERTIFICATE_KINDS.find((k) => k.id === type) ?? CERTIFICATE_KINDS[0];
}

/** The id both documents share: one of each type per hiker. */
export function certificateId(uid: string, type: CertificateType): string {
  return `${uid}_${type}`;
}

export interface CertificateRecord {
  id: string;
  uid: string;
  type: CertificateType;
  fileName: string;
  mimeType: string;
  /** Bytes of the stored file. */
  size: number;
  status: CertificateStatus;
  /** Why an admin rejected it (shown to the hiker). */
  note: string;
  uploadedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string;
  userName: string;
  userEmail: string;
}

/** Largest file that fits in one Firestore document once encoded. */
export const CERTIFICATE_MAX_BYTES = 650 * 1024;
