/**
 * The admin panel's own Firebase connection.
 *
 * Same project and config as the hiker app (firebase.config.ts), but a
 * separately NAMED app instance. Firebase keeps one sign-in per app name, so:
 *
 *   - signing in to /admin does not sign the hiker app out, or the reverse;
 *   - the hiker app's session-expiry check never touches the admin session;
 *   - every admin read and write goes out with the admin's credentials, which
 *     is what firestore.rules checks.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseConfig } from '../../firebase.config';

const ADMIN_APP_NAME = 'trailbound-admin';

const adminApp: FirebaseApp = getApps().some((a) => a.name === ADMIN_APP_NAME)
  ? getApp(ADMIN_APP_NAME)
  : initializeApp(firebaseConfig, ADMIN_APP_NAME);

export const adminAuth: Auth = getAuth(adminApp);
export const adminDb: Firestore = getFirestore(adminApp);
