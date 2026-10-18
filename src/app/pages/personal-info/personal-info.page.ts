import { Component, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonIcon, IonButtons, IonButton,
  IonItem, IonInput, IonLabel, IonSelect, IonSelectOption, IonTextarea, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { pencilOutline } from 'ionicons/icons';
import { UserService } from '../../services/user.service';
import {
  fieldError, minAgeValidator, nameValidator, phoneValidator,
} from '../../validators/form.validators';

const LABELS: Record<string, string> = {
  name: 'Full name',
  phone: 'Phone number',
  dob: 'Date of birth',
  gender: 'Gender',
  location: 'Location',
  bio: 'Bio',
  emergencyContactName: 'Contact name',
  emergencyContactPhone: 'Contact phone',
};

@Component({
  selector: 'app-personal-info',
  standalone: true,
  templateUrl: './personal-info.page.html',
  styleUrls: ['./personal-info.page.scss'],
  imports: [
    CommonModule, ReactiveFormsModule, IonContent, IonHeader, IonToolbar,
    IonTitle, IonIcon, IonButtons, IonButton, IonItem, IonInput, IonLabel,
    IonSelect, IonSelectOption, IonTextarea,
  ],
})
export class PersonalInfoPage implements OnInit {
  form!: FormGroup;
  avatarPreview = '';
  saving = false;
  /** False = read-only view. The pencil in the header switches this on. */
  editing = false;
  today = new Date().toISOString().split('T')[0];

  constructor(
    private fb: FormBuilder,
    public userService: UserService,
    private location: Location,
    private toastCtrl: ToastController,
  ) {
    addIcons({ pencilOutline });
  }

  ngOnInit() {
    const p = this.userService.profile();
    this.avatarPreview = p.avatar;
    this.form = this.fb.group({
      name: [p.name, [Validators.required, Validators.minLength(2), Validators.maxLength(60), nameValidator()]],
      // Email is the login identity, so it is shown but not editable here.
      email: [{ value: p.email, disabled: true }],
      phone: [p.phone, [Validators.required, phoneValidator()]],
      dob: [p.dob, [Validators.required, minAgeValidator(13)]],
      gender: [p.gender, [Validators.required]],
      location: [p.location, [Validators.maxLength(80)]],
      bio: [p.bio, [Validators.maxLength(160)]],
      emergencyContactName: [p.emergencyContactName, [Validators.maxLength(60), nameValidator()]],
      emergencyContactPhone: [p.emergencyContactPhone, [phoneValidator()]],
    });
  }

  /** In edit mode, back discards the changes and returns to the read-only view. */
  goBack() {
    if (this.editing) {
      this.cancelEdit();
      return;
    }
    this.location.back();
  }

  startEdit() {
    this.editing = true;
  }

  private cancelEdit() {
    const p = this.userService.profile();
    this.form.reset({
      name: p.name,
      email: p.email,
      phone: p.phone,
      dob: p.dob,
      gender: p.gender,
      location: p.location,
      bio: p.bio,
      emergencyContactName: p.emergencyContactName,
      emergencyContactPhone: p.emergencyContactPhone,
    });
    this.avatarPreview = p.avatar;
    this.editing = false;
  }

  /** Empty fields read "Not set" in view mode and show the hint while editing. */
  ph(hint: string): string {
    return this.editing ? hint : 'Not set';
  }

  triggerFileInput() {
    if (!this.editing) return;
    (document.getElementById('avatarFileInput') as HTMLInputElement | null)?.click();
  }

  async onAvatarFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      await this.toast('Please choose an image file.', 'danger');
      return;
    }
    try {
      this.avatarPreview = await this.resizeToSquare(file, 256);
    } catch {
      await this.toast('Could not read that image.', 'danger');
    }
  }

  /** Center-crops to a square and shrinks it so it fits comfortably in a Firestore document. */
  private resizeToSquare(file: File, size: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d')!.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('bad image'));
      };
      img.src = url;
    });
  }

  err(name: string) {
    return fieldError(this.form.get(name), LABELS[name] ?? name);
  }

  get bioLength() {
    return (this.form.get('bio')?.value ?? '').length;
  }

  async save() {
    if (this.saving) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      await this.toast('Please fix the highlighted fields.', 'danger');
      return;
    }
    this.saving = true;
    try {
      // getRawValue includes the disabled email; drop it so it is never written from here.
      const { email, ...v } = this.form.getRawValue();
      await this.userService.updateProfile({
        name: v.name.trim(),
        phone: v.phone.trim(),
        dob: v.dob,
        gender: v.gender,
        location: (v.location ?? '').trim(),
        bio: (v.bio ?? '').trim(),
        emergencyContactName: (v.emergencyContactName ?? '').trim(),
        emergencyContactPhone: (v.emergencyContactPhone ?? '').trim(),
        avatar: this.avatarPreview,
      });
      this.form.patchValue({
        name: v.name.trim(),
        phone: v.phone.trim(),
        location: (v.location ?? '').trim(),
        bio: (v.bio ?? '').trim(),
        emergencyContactName: (v.emergencyContactName ?? '').trim(),
        emergencyContactPhone: (v.emergencyContactPhone ?? '').trim(),
      });
      this.editing = false;
      await this.toast('Profile updated successfully!', 'success');
    } catch (e) {
      console.error(e);
      await this.toast('Could not save changes. Please try again.', 'danger');
    } finally {
      this.saving = false;
    }
  }

  private async toast(message: string, color: 'success' | 'danger') {
    const t = await this.toastCtrl.create({ message, duration: 1800, position: 'top', color });
    t.present();
  }
}
