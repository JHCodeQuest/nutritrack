# NutriTrack

A calorie and macro tracker that runs entirely in the browser as an installable
PWA. Log food against four meals a day, scan barcodes to add items, and keep a
rolling history.

## Features

- **Daily logging** across Breakfast, Lunch, Dinner and Snacks
- **Calorie and macro goals** — defaults to 2201 kcal with carb/protein/fat
  targets, all adjustable
- **Barcode scanning** to look up and add food without typing
- **Date navigation** — browse and edit previous days
- **30-day history** kept locally
- **Offline-capable** — a service worker (`sw.js`) plus a web app manifest make
  it installable to a phone home screen
- **Local-first storage** with `localStorage`, and Firebase (`firebase.js`) for
  sync

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | App shell |
| `app.js` | State, meal logging, goals, history, scanner |
| `app.css` | Styles |
| `firebase.js` | Firebase initialisation |
| `sw.js` | Service worker for offline use |
| `manifest.json` | PWA manifest |

## Running it

No build step — it is plain HTML, CSS and JavaScript. Serve the folder over
HTTP (a service worker and the camera both need a secure context):

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.
