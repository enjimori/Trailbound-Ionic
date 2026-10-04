import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonIcon, IonInput, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { eyeOutline, eyeOffOutline, leaf } from 'ionicons/icons';
import { UserService } from '../../services/user.service';
import { emailValidator, fieldError } from '../../validators/form.validators';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [CommonModule, ReactiveFormsModule, IonContent, IonIcon, IonInput],
})
export class LoginPage {
  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private router = inject(Router);
  private toastCtrl = inject(ToastController);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, emailValidator()]],
    password: ['', [Validators.required]],
  });

  loading = false;
  showPw = false;
  /** Result of the account check (wrong password, unknown account, etc.). */
  loginError = '';

  constructor() {
    addIcons({ eyeOutline, eyeOffOutline, leaf });
    this.form.valueChanges.subscribe(() => (this.loginError = ''));
  }

  err(name: 'email' | 'password') {
    return fieldError(this.form.get(name), name === 'email' ? 'Email' : 'Password');
  }

  async signIn() {
    if (this.loading) return;
    // 1) Syntax check
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    // 2) Account check against Firebase
    this.loading = true;
    try {
      const { email, password } = this.form.getRawValue();
      await this.userService.signIn(email, password);
      const toast = await this.toastCtrl.create({
        message: 'Welcome back!',
        duration: 1400,
        position: 'top',
        color: 'success',
      });
      toast.present();
      this.router.navigate(['/tabs/home'], { replaceUrl: true });
    } catch (e: any) {
      this.loginError = e?.message ?? 'Could not sign in. Please try again.';
    } finally {
      this.loading = false;
    }
  }

  goSignUp() {
    this.router.navigate(['/signup']);
  }

  /** Browse the app without an account. */
  continueAsGuest() {
    this.router.navigate(['/tabs/home'], { replaceUrl: true });
  }
}
