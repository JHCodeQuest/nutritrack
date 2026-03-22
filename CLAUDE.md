# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NutriTrack is a single-file vanilla JavaScript nutrition tracking web app. The entire application — HTML, CSS, and JS — lives in **`index.html`** (~845 lines). There is no build system, no package manager, and no backend.

## Running the App

Open `index.html` directly in a browser or serve it with any static file server:
```
npx serve .
# or
python -m http.server 8080
```

## Architecture

**Single-file monolith:** All application code is in `index.html`. External dependencies are loaded from CDN:
- Firebase v10.12.0 (auth + Firestore)
- Quagga.js v0.12.1 (barcode scanning)
- Google Fonts (DM Sans, Syne)

**Firebase config is intentionally absent** — the `firebaseConfig` object was removed from version control (commit `7ed2642`). The app will not authenticate or save data until a valid config object is added before `initializeApp(firebaseConfig)` around line 24.

**Data persistence uses a dual strategy:**
1. Firestore (primary) — path: `users/{userId}/logs/{YYYY-MM-DD}`
2. localStorage fallback — key: `nutritrack_v1`, writes debounced at 3s

**Nutrition data** is fetched from the Open Food Facts API (`https://world.openfoodfacts.org/api/v0/product/{barcode}.json`) — no API key required.

## Key Constants

Located near the top of the `<script>` block in `index.html`:
- `GOAL = 2201` — daily calorie target (kcal)
- `MACRO_GOALS = {carbs: 220, protein: 140, fat: 73}` — daily macro targets (grams)

## State Model

- `meals[]` — 4 meal types (breakfast, lunch, dinner, snacks), each with a `foods[]` array
- `currentDateKey` — active date in `YYYY-MM-DD` format
- `dayOffset` — days from today (0 = today)
- Changing `dayOffset` resubscribes the Firestore `onSnapshot()` listener for that date

## Auth Flow

```
onAuthStateChanged → logged in  → showApp() + subscribeToFirestore()
                   → logged out → showLoginScreen()
```

Google OAuth popup via `signInWithGoogle()`. All user data is scoped to the Firebase UID.
