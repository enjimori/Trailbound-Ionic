/**
 * Certificate service: manages hiking-document upload, review status, and summary data consumed by profile, document, and booking screens.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import { onAuthStateChanged } from 'firebase/auth';
import {
  type Unsubscribe, collection, doc, getDoc, onSnapshot, query, serverTimestamp, where, writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase.client';
import { UserService } from './user.service';
import { looksLikeImage } from './photo.util';
import {
  CERTIFICATE_KINDS, CERTIFICATE_MAX_BYTES, CertificateRecord, CertificateType, certificateId,
} from '../models/certificate.model';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CERTIFICATE SERVICE — the signed-in hiker's hiking documents
 *
 * Medical certificate, one per hiker. See
 * certificate.model.ts for how they are stored. The hiker's own records
 * stream live, so when an admin approves or rejects a file the Documents
 * page and the Profile tab update straight away.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Longest side of a document photo. Big enough to read small print. */
const IMAGE_MAX_SIDE = 2000;
/** Characters of data URL that still fit in one Firestore document. */
const DATA_MAX_CHARS = 900_000;

export interface PreparedFile {
  data: string;
  mimeType: string;
  fileName: string;
  size: number;
}

@Injectable({ providedIn: 'root' })
export class CertificateService {
  private readonly userService = inject(UserService);

  private readonly _records = signal<Partial<Record<CertificateType, CertificateRecord>>>({});
  private readonly _loaded = signal(false);
  readonly records = this._records.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /** One-line state for the Profile tab and reminders. */
  readonly summary = computed(() => {
    const recs = this._records();
    const list = CERTIFICATE_KINDS.map((k) => recs[k.id]);
    const missing = list.filter((r) => !r).length;
    const rejected = list.filter((r) => r?.status === 'rejected').length;
    const pending = list.filter((r) => r?.status === 'pending').length;
    const allApproved = list.every((r) => r?.status === 'approved');
    const label = allApproved
      ? 'Verified'
      : rejected
        ? 'Action needed'
        : missing
          ? `${missing} needed`
          : 'In review';
    return { missing, rejected, pending, allApproved, label };
  });

  private unsub?: Unsubscribe;
  private readonly fileCache = new Map<string, string>();

  constructor() {
    onAuthStateChanged(auth, (user) => {
      this.unsub?.();
      this.unsub = undefined;
      this._records.set({});
      this._loaded.set(false);
      this.fileCache.clear();
      if (!user) return;

      this.unsub = onSnapshot(
        query(collection(db, 'certificates'), where('uid', '==', user.uid)),
        (snap) => {
          const map: Partial<Record<CertificateType, CertificateRecord>> = {};
          for (const d of snap.docs) {
            if (d.data()['type'] !== 'medical') continue;
            const r = toRecord(d.id, d.data({ serverTimestamps: 'estimate' }));
            map[r.type] = r;
          }
          this._records.set(map);
          this._loaded.set(true);
        },
        (err) => {
          console.warn('Could not read hiking documents.', err);
          this._loaded.set(true);
        },
      );
    });
  }

  /**
   * Uploads (or replaces) one document. A replaced document goes back to
   * "under review". Throws an Error whose message is safe to show.
   */
  async upload(type: CertificateType, file: File): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in first.');

    const prepared = await prepareFile(file);
    const id = certificateId(user.uid, type);
    const batch = writeBatch(db);
    batch.set(doc(db, 'certificate_files', id), {
      uid: user.uid,
      type,
      data: prepared.data,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'certificates', id), {
      uid: user.uid,
      type,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      size: prepared.size,
      status: 'pending',
      note: '',
      uploadedAt: serverTimestamp(),
      reviewedAt: null,
      reviewedBy: '',
      userName: this.userService.profile().name || user.displayName || '',
      userEmail: user.email ?? '',
    });
    try {
      await batch.commit();
    } catch (e) {
      console.error('Upload failed', e);
      throw new Error('Could not upload the file. Check your connection and try again.');
    }
    this.fileCache.set(id, prepared.data);
  }

  /** The stored file as a data URL, for viewing. */
  async fileFor(type: CertificateType): Promise<string> {
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in first.');
    const id = certificateId(user.uid, type);
    const cached = this.fileCache.get(id);
    if (cached) return cached;
    const snap = await getDoc(doc(db, 'certificate_files', id));
    const data = String(snap.data()?.['data'] ?? '');
    if (!data) throw new Error('The file could not be found.');
    this.fileCache.set(id, data);
    return data;
  }

  /** Removes the selected record through the owning service and refreshes the view. */
  async remove(type: CertificateType): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;
    const id = certificateId(user.uid, type);
    const batch = writeBatch(db);
    batch.delete(doc(db, 'certificates', id));
    batch.delete(doc(db, 'certificate_files', id));
    await batch.commit();
    this.fileCache.delete(id);
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function toRecord(id: string, d: Record<string, any>): CertificateRecord {
  const status = d['status'];
  return {
    id,
    uid: String(d['uid'] ?? ''),
    type: 'medical',
    fileName: String(d['fileName'] ?? 'document'),
    mimeType: String(d['mimeType'] ?? ''),
    size: Number(d['size'] ?? 0) || 0,
    status: status === 'approved' || status === 'rejected' ? status : 'pending',
    note: String(d['note'] ?? ''),
    uploadedAt: d['uploadedAt']?.toDate?.() ?? null,
    reviewedAt: d['reviewedAt']?.toDate?.() ?? null,
    reviewedBy: String(d['reviewedBy'] ?? ''),
    userName: String(d['userName'] ?? ''),
    userEmail: String(d['userEmail'] ?? ''),
  };
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Turns a picked file into something that fits one Firestore document. */
export async function prepareFile(file: File): Promise<PreparedFile> {
  if (isPdf(file)) {
    if (file.size > CERTIFICATE_MAX_BYTES) {
      throw new Error('That PDF is over 650 KB. Upload a photo of the document instead, or make the PDF smaller first.');
    }
    const data = await readAsDataUrl(file);
    return { data, mimeType: 'application/pdf', fileName: file.name, size: file.size };
  }

  if (looksLikeImage(file)) {
    let data: string;
    try {
      data = await compressDocumentPhoto(file);
    } catch {
      throw new Error('Could not read that photo. Try a JPG or PNG.');
    }
    const base = file.name.replace(/\.[^.]+$/, '') || 'document';
    return { data, mimeType: 'image/jpeg', fileName: `${base}.jpg`, size: Math.round((data.length * 3) / 4) };
  }

  throw new Error('Use a photo (JPG or PNG) or a PDF.');
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Re-draws a document photo as JPEG, shrinking until it fits. Keeps more
 * resolution than a post photo so names, dates and signatures stay readable.
 * Re-drawing also strips the phone's location data from the photo.
 */
async function compressDocumentPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('decode'));
      i.src = url;
    });
    let side = IMAGE_MAX_SIDE;
    let quality = 0.85;
    for (let attempt = 0; attempt < 10; attempt++) {
      const out = drawJpeg(img, side, quality);
      if (out.length <= DATA_MAX_CHARS) return out;
      if (quality > 0.65) quality = Math.round((quality - 0.1) * 100) / 100;
      else side = Math.round(side * 0.8);
    }
    return drawJpeg(img, 1000, 0.6);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawJpeg(img: HTMLImageElement, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}
