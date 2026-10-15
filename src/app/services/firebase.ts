/**
 * Firebase bootstrap — one app instance for the whole project.
 *
 * WHERE THE VALUES COME FROM
 *   Firebase console -> your project -> Project settings (gear icon)
 *   -> "Your apps" -> the web app (</> icon) -> SDK setup and configuration
 *   -> Config. Copy each value across.
 *
 * IS THIS A SECRET?
 *   No. A Firebase web config identifies your project; it does not authorise
 *   anything. It ships inside every built bundle of every Firebase web app,
 *   so anyone who opens devtools on your deployed site can read it. It is
 *   safe in a public repo. (This is NOT true of the CARTO key, which spends
 *   quota — keep that one out of public repos.)
 *
 *   What actually protects the data is firestore.rules. Until those are
 *   deployed, your database is as open as the console left it.
 */
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'PASTE_YOUR_API_KEY',
  authDomain: 'trailbound-ionic.firebaseapp.com',
  projectId: 'trailbound-ionic',
  storageBucket: 'trailbound-ionic.firebasestorage.app',
  messagingSenderId: 'PASTE_YOUR_SENDER_ID',
  appId: 'PASTE_YOUR_APP_ID',
};

/**
 * `getApps().length` guard: Angular's dev server hot-reloads modules, and
 * calling initializeApp twice on the same name throws. This makes the module
 * safe to re-evaluate.
 */
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const firebaseAuth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);

/**
 * True once the placeholders above have been replaced. The admin login shows
 * a plain "not configured yet" message instead of a confusing Firebase error
 * when this is false.
 */
export function isFirebaseConfigured(): boolean {
  return !firebaseConfig.apiKey.startsWith('PASTE_');
}
