import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, Location, NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonTitle, IonToolbar,
  AlertController, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  alertCircle, arrowBackOutline, checkmarkCircle, closeOutline, cloudUploadOutline,
  documentAttachOutline, documentTextOutline, downloadOutline, eyeOutline, lockClosedOutline,
  medkitOutline, timeOutline, trashOutline,
} from 'ionicons/icons';

import { CertificateService } from '../../services/certificate.service';
import {
  CERTIFICATE_KINDS, CertificateKind, CertificateRecord, CertificateType,
} from '../../models/certificate.model';

/**
 * HIKING DOCUMENTS — upload a medical certificate and a barangay clearance.
 * Each one shows whether TrailBound has approved it, is still checking it,
 * or needs a new file (with the admin's reason).
 */
@Component({
  selector: 'app-documents',
  standalone: true,
  templateUrl: './documents.page.html',
  styleUrls: ['./documents.page.scss'],
  imports: [
    DatePipe, NgTemplateOutlet, IonHeader, IonToolbar, IonButtons, IonButton, IonTitle, IonContent, IonIcon, IonModal,
  ],
})
export class DocumentsPage {
  readonly certs = inject(CertificateService);
  private readonly location = inject(Location);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);

  readonly kinds = CERTIFICATE_KINDS;
  readonly cards = computed(() =>
    this.kinds.map((kind) => ({ kind, rec: this.certs.records()[kind.id] as CertificateRecord | undefined })),
  );
  readonly uploading = signal<CertificateType | null>(null);

  readonly viewerOpen = signal(false);
  readonly viewerTitle = signal('');
  readonly viewerImage = signal<string | null>(null);
  readonly viewerPdf = signal<SafeResourceUrl | null>(null);
  readonly viewerDownload = signal<{ url: string; name: string } | null>(null);
  readonly viewerLoading = signal(false);
  private blobUrl: string | null = null;

  constructor() {
    addIcons({
      alertCircle, arrowBackOutline, checkmarkCircle, closeOutline, cloudUploadOutline,
      documentAttachOutline, documentTextOutline, downloadOutline, eyeOutline, lockClosedOutline,
      medkitOutline, timeOutline, trashOutline,
    });
  }

  record(type: CertificateType): CertificateRecord | undefined {
    return this.certs.records()[type];
  }

  statusLabel(r: CertificateRecord | undefined): string {
    if (!r) return 'Not uploaded';
    return r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Needs a new file' : 'Under review';
  }

  goBack(): void {
    this.location.back();
  }

  pick(input: HTMLInputElement): void {
    input.value = '';
    input.click();
  }

  async onFile(kind: CertificateKind, event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.uploading.set(kind.id);
    try {
      await this.certs.upload(kind.id, file);
      this.toast(`${kind.title} uploaded. We'll check it soon.`);
    } catch (e) {
      this.toast((e as Error).message, 'danger');
    } finally {
      this.uploading.set(null);
    }
  }

  async view(kind: CertificateKind): Promise<void> {
    const r = this.record(kind.id);
    if (!r) return;
    this.viewerTitle.set(kind.title);
    this.viewerImage.set(null);
    this.viewerPdf.set(null);
    this.viewerDownload.set(null);
    this.viewerLoading.set(true);
    this.viewerOpen.set(true);
    try {
      const data = await this.certs.fileFor(kind.id);
      const blob = await (await fetch(data)).blob();
      this.revoke();
      this.blobUrl = URL.createObjectURL(blob);
      this.viewerDownload.set({ url: this.blobUrl, name: r.fileName });
      if (r.mimeType === 'application/pdf') {
        this.viewerPdf.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.blobUrl));
      } else {
        this.viewerImage.set(data);
      }
    } catch (e) {
      this.viewerOpen.set(false);
      this.toast((e as Error).message || 'Could not open the file.', 'danger');
    } finally {
      this.viewerLoading.set(false);
    }
  }

  closeViewer(): void {
    this.viewerOpen.set(false);
    this.revoke();
  }

  async remove(kind: CertificateKind): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: `Remove ${kind.title.toLowerCase()}?`,
      message: 'You will need to upload it again before your hike.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: async () => {
            try {
              await this.certs.remove(kind.id);
              this.toast(`${kind.title} removed`);
            } catch {
              this.toast('Could not remove the file. Please try again.', 'danger');
            }
          },
        },
      ],
    });
    alert.present();
  }

  private revoke(): void {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = null;
  }

  private async toast(message: string, color = 'dark'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2600, position: 'top', color });
    t.present();
  }
}
