# TrailBound — Ionic Angular App

A hiking & trail community app built with **Ionic 8 + Angular 18 (standalone components)**, recreating the Home, TrailBound community feed, Notifications, Profile, and Personal Info screens — fully wired up and interactive.

## Features implemented

- **Home** — live search over trails, category filter chips (Nearby/Popular/Scenic/Forest), weather alert banner (tap for detail toast), trail cards with a working **DETAILS** button that opens a full trail page, notification bell with unread badge, and a community posts preview strip.
- **Explore tab** — full trail catalog with search + difficulty segment filter.
- **TrailBound (Community)** — real feed stored in Firestore (`posts`, `posts/{id}/comments`, `profiles`). Signed-in users post with **photo upload** (up to 4, resized and GPS-stripped) and an optional **trail tag**; every post and comment shows the **account that wrote it** (name + profile photo). Includes **likes**, **comments** (with Author / You tags), **edit / delete** your own posts, delete your own comments (or any comment on your post), **share** links that jump to the post, a full-screen photo viewer, and Latest / Top / My posts filters. Guests can read everything and are asked to sign in to post, like or comment.
- **Notifications** — tapping a notification marks it read and routes contextually (weather → Home, maintenance → trail detail, social → Community, tips → info alert). "Mark all" clears the unread badge everywhere.
- **Planner tab** — upcoming adventures list with add/remove, feeding the Profile page's "Upcoming Adventures".
- **Profile** — stats, upcoming adventures (tap → trail detail), account menu (Personal Info, Notifications, Privacy & Security, Help Center), and a **Sign Out** flow with confirmation that routes to a Login screen.
- **Personal Info** — reactive form with validation (name, email, phone, DOB, gender, emergency contact), tap-to-change avatar (reads a local image file, no backend needed), and **Save** persists back to the shared user state.
- **Trail Detail** — full trail page with stats grid, description, "Start Hike" action, and "Add to Planner" (syncs with Planner + Profile).

All state is held in Angular **signals** inside injectable services (`TrailService`, `PostService`, `NotificationService`, `UserService`, `WeatherService`) — no backend required, everything works fully offline with realistic mock data.

## Getting started

```bash
npm install
npm start
```

Then open the printed local URL (usually `http://localhost:4200`). For the best mobile-app feel, open Chrome DevTools device toolbar and pick an iPhone/Android preset.

### Run as a native app (optional)

```bash
npm install -g @ionic/cli
ionic build
npx cap add ios      # or: npx cap add android
npx cap sync
npx cap open ios     # or: npx cap open android
```

## Admin panel

Open **`/admin`** in the browser (for example `http://localhost:8100/admin`).

| | |
|---|---|
| Username | `admin` |
| Password | `TrailBound@2026` — first sign-in only; change it in **Admin → Settings** |

The first sign-in with that username and password creates the admin login in
Firebase Authentication. After that, only the password Firebase holds works.
Accounts are set in `src/app/pages/admin/admin.config.ts`.

**Before it can read everything, publish `firestore.rules`:** Firebase console →
Firestore Database → Rules → paste the whole file → Publish. Until then the
panel shows a yellow "Firebase is blocking some admin data" banner.

What an admin can do:

- **Dashboard** — revenue, bookings and hikers, a revenue chart (week / month / year), recent bookings, trail status and community activity.
- **Bookings** — every hiker's bookings; search, filter, full receipt, mark completed, cancel, delete, export to CSV.
- **Hikers** — every account with profile, bookings, spend and saved trails; suspend / reactivate, make admin / remove admin, delete profile data.
- **Trails** — the 30 trails; close one for booking with a reason (the app shows it and turns off **Book**), reopen it.
- **Community** — every post and its comments; remove a comment or a whole post.
- **Reviews** — every trail review; remove one.
- **Certificates** — each hiker's medical certificate and barangay clearance; view the file, approve it, or reject it with a reason the hiker sees. Also lists hikers with an upcoming hike who are still missing a document. The sidebar shows how many are waiting.
- **Packages** — packages, activities, guides and merchandise with how often each is booked (prices live in `booking-catalog.ts`).
- **Settings** — change the admin password, see who else is an admin, check Firestore access.

To make another person an admin, open them in **Hikers** and choose **Make admin**;
they sign in to `/admin` with their own email and password.

Hikers upload their documents in the app from **Profile → Hiking Documents**
(a photo or a PDF up to 650 KB). Files are stored inside Firestore
(`certificates` + `certificate_files`), like post photos, so no paid Firebase
Storage plan is needed.

What the app writes to Firestore for the panel: each confirmed booking
(`bookings/{id}`, with the hiker's uid), each signed-in hiker's review
(`reviews/{id}`), hiking documents (`certificates/{uid}_{type}`), and the
admin's trail closures (`trail_status/{id}`).
Bookings and reviews saved only on a phone before this version are not in
Firestore, so the panel cannot see those.

## Project structure

```
src/app/
  models/            Trail, Post, Notification, UserProfile interfaces
  services/          Signal-based state + mock data
  components/        Reusable trail-card & post-card
  tabs/              Bottom tab bar (Home, Explore, Community, Planner, Profile)
  pages/
    home/            Screenshot 1
    community/       Screenshot 2 (TrailBound feed)
    notifications/   Screenshot 2 (Notifications)
    profile/         Screenshot 3 (Profile)
    personal-info/   Screenshot 3 (Personal Info)
    explore/         Extra tab: full trail catalog
    planner/         Extra tab: upcoming adventures management
    trail-detail/     Full trail page opened from "DETAILS"
    login/           Shown after Sign Out
```

## Notes

- Images are pulled from Unsplash/Pravatar URLs for a realistic look — swap in your own asset paths in the services if you'd rather bundle local images.
- Dark theme + green accent colors are defined in `src/theme/variables.scss`.
