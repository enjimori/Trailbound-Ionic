import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_PATTERN = /^\p{L}[\p{L}\s'.-]*$/u;

/** Email must look like name@domain.tld */
export function emailValidator(): ValidatorFn {
  return (c: AbstractControl): ValidationErrors | null => {
    const v = (c.value ?? '').toString().trim();
    if (!v) return null; // let `required` handle empties
    return EMAIL_PATTERN.test(v) ? null : { emailFormat: true };
  };
}

/** Letters, spaces, apostrophes, hyphens, periods only. */
export function nameValidator(): ValidatorFn {
  return (c: AbstractControl): ValidationErrors | null => {
    const v = (c.value ?? '').toString().trim();
    if (!v) return null;
    return NAME_PATTERN.test(v) ? null : { namePattern: true };
  };
}

/** Optional-friendly phone check: 10–15 digits, allows + space - ( ). */
export function phoneValidator(): ValidatorFn {
  return (c: AbstractControl): ValidationErrors | null => {
    const v = (c.value ?? '').toString().trim();
    if (!v) return null;
    const digits = v.replace(/\D/g, '');
    const ok = /^\+?[0-9\s\-()]+$/.test(v) && digits.length >= 10 && digits.length <= 15;
    return ok ? null : { phone: true };
  };
}

/** Date of birth: valid, not in the future, at least `minAge` years old. */
export function minAgeValidator(minAge: number): ValidatorFn {
  return (c: AbstractControl): ValidationErrors | null => {
    const v = c.value;
    if (!v) return null;
    const dob = new Date(v);
    if (isNaN(dob.getTime())) return { dob: true };
    const today = new Date();
    if (dob > today) return { futureDob: true };
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    if (age > 120) return { dob: true };
    return age < minAge ? { minAge: { required: minAge } } : null;
  };
}

/** Password: 8+ chars, at least one letter and one number. */
export function passwordValidator(): ValidatorFn {
  return (c: AbstractControl): ValidationErrors | null => {
    const v = (c.value ?? '').toString();
    if (!v) return null;
    return v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v) ? null : { password: true };
  };
}

/** Group-level: two fields must match. Sets `mismatch` on the group. */
export function matchValidator(a: string, b: string): ValidatorFn {
  return (g: AbstractControl): ValidationErrors | null => {
    const x = g.get(a)?.value;
    const y = g.get(b)?.value;
    return x && y && x !== y ? { mismatch: true } : null;
  };
}

/** Turns a control's errors into one user-facing message (only after touched/dirty). */
export function fieldError(c: AbstractControl | null, label: string): string | null {
  if (!c || !c.invalid || !(c.dirty || c.touched)) return null;
  const e = c.errors ?? {};
  if (e['required']) return `${label} is required.`;
  if (e['emailFormat']) return 'Enter a valid email address (e.g. you@example.com).';
  if (e['taken']) return 'This email is already registered. Try logging in instead.';
  if (e['minlength']) return `${label} must be at least ${e['minlength'].requiredLength} characters.`;
  if (e['maxlength']) return `${label} must be at most ${e['maxlength'].requiredLength} characters.`;
  if (e['namePattern']) return `${label} can only contain letters, spaces, apostrophes, hyphens and periods.`;
  if (e['phone']) return 'Enter a valid phone number (10–15 digits, e.g. +63 900 000 0000).';
  if (e['futureDob']) return 'Date of birth cannot be in the future.';
  if (e['minAge']) return `You must be at least ${e['minAge'].required} years old.`;
  if (e['dob']) return 'Enter a valid date of birth.';
  if (e['password']) return 'Use at least 8 characters with a letter and a number.';
  return `${label} is invalid.`;
}
