/**
 * Admin services use the same Firebase session as the main app, so a user
 * promoted to admin can sign in once and open the admin panel.
 */
export { auth as adminAuth, db as adminDb } from '../../services/firebase.client';
