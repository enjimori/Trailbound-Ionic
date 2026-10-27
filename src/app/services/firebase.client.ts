/**
 * Firebase client initializer: turns the project configuration into shared Firebase app, authentication, and database instances used by services.
 */
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../firebase.config';

export const firebaseApp = initializeApp(firebaseConfig);

// On localhost, App Check prints a debug token in the browser console.
// Register that token in Firebase console > App Check > Apps > Manage debug tokens.
if (location.hostname === 'localhost') {
  (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

// Must run right after initializeApp, before the app calls any Firebase service.
export const appCheck = initializeAppCheck(firebaseApp, {
  provider: new ReCaptchaEnterpriseProvider('6LfCyQIuAAAAAJOLDW9sfIguSQme9BUzYJWDL_mc'),
  isTokenAutoRefreshEnabled: true,
});

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);