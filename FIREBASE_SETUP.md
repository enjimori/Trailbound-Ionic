# Firebase setup for TrailTalk

## 1. Create the project
1. Go to https://console.firebase.google.com and click **Add project**.
2. In the project, click the **Web** icon (`</>`) to register a web app. Copy the `firebaseConfig` values.
3. Paste them into `src/app/firebase.config.ts`.

## 2. Enable Authentication
Build → **Authentication** → Get started → Sign-in method → enable **Email/Password**.

## 3. Create Firestore
Build → **Firestore Database** → Create database → choose a location near you (e.g. `asia-southeast1`) → start in **production mode**.

Then open the **Rules** tab and paste the contents of `firestore.rules`, then **Publish**.

## 4. Install the SDK
```bash
npm install firebase
```

## 5. Run
```bash
ionic serve
```

## Data layout
```
users/{uid}
  profile:  { name, email, phone, dob, gender, location, bio, avatar, ... }
  upcoming: [ { id, trailId, name, image, date, duration }, ... ]
```

## Notes
- Sign-in errors say "Incorrect email or password" for both unknown accounts and wrong passwords. This is deliberate: Firebase hides which one it was, so attackers can't discover which emails are registered.
- Email is read-only in Personal Info. Changing a login email in Firebase needs re-authentication and a verification email, which is a separate feature.
- Avatars are cropped to 256x256 and stored as a small data URL inside the user document, so no Firebase Storage (paid plan) is needed.
