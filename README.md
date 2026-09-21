# Skittles Scorer

South Molton Skittles Scorer is an offline-capable Progressive Web App for scoring league matches on the phone — including with no signal. Match cards, lineups, pins, and chalkboard photos are stored locally (IndexedDB). League teams, fixtures, and rosters ship as seed data in the app.

## Stack

- Static PWA: HTML, CSS, and vanilla JavaScript
- Service worker (`sw.js`) caches the app shell for offline use
- Web App Manifest (`manifest.webmanifest`) for install / standalone display
- No build step and no backend required for local scoring

## Run locally

Requires Node.js (for the static file server).

```bash
npm run dev
```

Then open [http://127.0.0.1:43127](http://127.0.0.1:43127).

You can also serve the folder with any static server, for example:

```bash
python3 -m http.server 43127
```

## Demo PIN

The in-app demo PIN is `1234`.

## Deploy notes

`_headers` is included for hosts that honour it (for example Netlify): no-cache for HTML / SW / manifest, long-cache for fonts.
