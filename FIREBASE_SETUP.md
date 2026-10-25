# Firebase setup for TrailBound

## 1. Create the project
1. Go to https://console.firebase.google.com and click **Add project**.
2. In the project, click the **Web** icon (`</>`) to register a web app. Copy the `firebaseConfig` values.
3. Paste them into `src/app/firebase.config.ts`.

## 2. Enable Authentication
Build → **Authentication** → Get started → Sign-in method → enable **Email/Password**.

## 3. Create Firestore
Build → **Firestore Database** → Create database → choose a location near you (e.g. `asia-southeast1`) → start in **production mode**.

Then open the **Rules** tab and paste the contents of `firestore.rules`, then **Publish**.

## 4. Enable admin access
The admin panel uses the same Firebase configuration, Authentication session, and
Firestore database as the hiker app. It does not need a second Firebase app or
separate credentials.

- Enable **Email/Password** sign-in and create/sign in to the admin account in
  Firebase Authentication.
- The built-in owner account is listed in `src/app/pages/admin/admin.config.ts`.
  Its email must also be allowed by `isAdmin()` in `firestore.rules`.
- To grant admin access to another account, sign in as an owner and promote the
  hiker from **Admin → Hikers**. The account then signs in with its regular app
  credentials.
- Publish `firestore.rules` after changing admin access rules. The panel cannot
  read or manage Firestore data until the deployed rules allow that admin.

## 5. Install the SDK
```bash
npm install firebase
```

## 6. Run
```bash
ionic serve
```

## Data layout
```
users/{uid}                       private, only the owner can read it
  profile:  { name, email, phone, dob, gender, location, bio, avatar, ... }
  upcoming: [ { id, trailId, name, image, date, duration }, ... ]

posts/{postId}                    Community feed, readable by everyone
  { authorUid, authorName, text, images: [jpeg data URLs], trailId?, trailName?,
    likedBy: [uid, ...], commentCount, createdAt, editedAt? }
posts/{postId}/comments/{id}
  { authorUid, authorName, text, createdAt }

profiles/{uid}                    public name + small photo of people who have
  { name, avatar, updatedAt }     posted or commented (shown on their posts)
```

**After pulling the Community update, publish `firestore.rules` again**
(Firestore → Rules → paste → Publish, or `firebase deploy --only firestore:rules`).
Until then the Community tab says the posts can't be read.

## Notes
- Sign-in errors say "Incorrect email or password" for both unknown accounts and wrong passwords. This is deliberate: Firebase hides which one it was, so attackers can't discover which emails are registered.
- Email is read-only in Personal Info. Changing a login email in Firebase needs re-authentication and a verification email, which is a separate feature.
- Avatars are cropped to 256x256 and stored as a small data URL inside the user document, so no Firebase Storage (paid plan) is needed.
- Post photos work the same way: each one is resized (max 1280px, about 200 KB) and stored inside the post, up to 4 per post, which keeps a post under Firestore's 1 MB document limit. Re-encoding also strips the GPS location phones embed in photos.
