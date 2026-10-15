import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonInput,
  IonPopover, IonDatetime, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline, calendarOutline, eyeOutline, eyeOffOutline, leaf } from 'ionicons/icons';
import { UserService } from '../../services/user.service';
import {
  emailValidator, fieldError, matchValidator, minAgeValidator, nameValidator,
  passwordValidator, phoneValidator,
} from '../../validators/form.validators';

/**
 * PH mobile numbers have 11 digits when they start with 0 (0917 123 4567)
 * or 12 digits when they start with 63 (+63 917 123 4567). Extra digits are
 * cut off as they are typed or pasted; spaces and the + sign are kept.
 */
function capPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  const max = digits.startsWith('0') ? 11 : 12;
  if (digits.length <= max) return value;
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    if (/\d/.test(value[i]) && ++count > max) return value.slice(0, i).trimEnd();
  }
  return value;
}

const LABELS: Record<string, string> = {
  name: 'Full name',
  email: 'Email',
  phone: 'Phone number',
  dob: 'Date of birth',
  gender: 'Gender',
  password: 'Password',
  confirmPassword: 'Confirm password',
};

@Component({
  selector: 'app-signup',
  standalone: true,
  templateUrl: './signup.page.html',
  styleUrls: ['./signup.page.scss'],
  imports: [
    CommonModule, ReactiveFormsModule, IonContent, IonHeader, IonToolbar,
    IonButtons, IonButton, IonIcon, IonInput, IonPopover, IonDatetime,
  ],
})
export class SignupPage {
  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private router = inject(Router);
  private toastCtrl = inject(ToastController);

  genders = ['Male', 'Female', 'Other', 'Prefer not to say'];
  today = new Date().toISOString().split('T')[0];
  loading = false;
  showPw = false;
  showPw2 = false;

  form = this.fb.nonNullable.group(
    {
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60), nameValidator()]],
      email: ['', [Validators.required, emailValidator()]],
      phone: ['', [Validators.required, phoneValidator()]],
      dob: ['', [Validators.required, minAgeValidator(13)]],
      gender: ['', [Validators.required]],
      password: ['', [Validators.required, passwordValidator()]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: matchValidator('password', 'confirmPassword') },
  );

  constructor() {
    addIcons({ arrowBackOutline, calendarOutline, eyeOutline, eyeOffOutline, leaf });
  }

  err(name: string): string | null {
    const c = this.form.get(name);
    if (name === 'confirmPassword') {
      if (!c || !(c.dirty || c.touched)) return null;
      if (c.hasError('required')) return 'Please confirm your password.';
      return this.form.hasError('mismatch') ? 'Passwords do not match.' : null;
    }
    return fieldError(c, LABELS[name] ?? name);
  }

  /** Live checklist under the password field. */
  get pwRules() {
    const v = this.form.controls.password.value;
    return {
      length: v.length >= 8,
      letter: /[A-Za-z]/.test(v),
      number: /\d/.test(v),
    };
  }

  /** Keeps the phone number to 11 digits (09…) or 12 digits (+63…). */
  limitPhone(ev: Event) {
    const el = ev.target as HTMLIonInputElement;
    const value = String(el.value ?? '');
    const capped = capPhoneDigits(value);
    if (capped !== value) {
      el.value = capped;
      this.form.controls.phone.setValue(capped);
    }
  }

  /**
   * Birthday picked in the calendar. Saved as "YYYY-MM-DD" — the same format
   * the old date input used — so the age check and sign-up data are unchanged.
   */
  setDob(ev: Event) {
    const value = (ev as CustomEvent<{ value?: string | string[] | null }>).detail.value;
    if (typeof value !== 'string') return;
    const c = this.form.controls.dob;
    c.setValue(value.split('T')[0]);
    c.markAsDirty();
    c.markAsTouched();
  }

  /**
   * Closes the calendar once a day is tapped. Changing the month or year
   * keeps it open, so the user can finish choosing.
   */
  closeOnDayTap(ev: Event, popover: IonPopover) {
    const tappedDay = ev.composedPath().some(
      (el) => el instanceof HTMLButtonElement && el.classList.contains('calendar-day'),
    );
    if (tappedDay) setTimeout(() => popover.dismiss(), 150);
  }

  setGender(g: string) {
    const c = this.form.controls.gender;
    c.setValue(g);
    c.markAsDirty();
    c.markAsTouched();
  }

  async submit() {
    if (this.loading) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      await this.toast('Please fix the highlighted fields.', 'danger');
      return;
    }
    this.loading = true;
    try {
      const { confirmPassword, ...data } = this.form.getRawValue();
      await this.userService.signUp(data);
      await this.toast('Account created. Welcome to TrailBound!', 'success');
      this.router.navigate(['/tabs/home'], { replaceUrl: true });
    } catch (e: any) {
      if (e?.code === 'auth/email-already-in-use') {
        this.form.controls.email.setErrors({ taken: true });
        this.form.controls.email.markAsTouched();
      }
      await this.toast(e?.message ?? 'Could not create account.', 'danger');
    } finally {
      this.loading = false;
    }
  }

  goLogin() {
    this.router.navigate(['/login'], { replaceUrl: true });
  }

  private async toast(message: string, color: 'success' | 'danger') {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    t.present();
  }
}
