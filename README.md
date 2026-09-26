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

## Team logins

Each team has its own 4-digit PIN (from the league team-logins list). On the login screen, pick the team, then enter that team’s PIN. Shared demo PIN `1234` is no longer accepted.

Login short names (for example `COLT`, `FARM`) are stored in seed data with each PIN for reference; the UI uses the team dropdown + PIN.

## Quick Match / Cup

After login, **Quick Match / Cup** lets you score as your logged-in team against any opponent. Choose a **match format** first:

- **League / friendly** — 8 players, 6 rubs, pin totals (existing Quick Match behaviour)
- **Western Counties** — 8 players, 6 rubs, Man for Man per rub (max 48). Rubs played 2 at a time; no final-rubs head-to-head play order.
- **Sid Squire** — 5 players, 8 rubs, pin totals
- **Pidler** — 8 players, 6 rubs, pin totals
- **Front Pin** — 6 players, 6 rubs, pin totals
- **Concrete** — 7 players, Man for Man on player totals (best of 7)

Then choose home or away and the opposing team. Cards list under **Your Quick Matches & Cups** with **Delete**. Empty slots show **Player Missing**.

## Share result PDF

On a completed match card (submitted, or fully ready to submit), use **Share result PDF** to open the phone share sheet with a PDF of the scores, or **Download PDF** to save the file. Works offline for league fixtures and Quick Matches. The PDF keeps the card’s line up and uses **Rub Score** (then Each rub, when double rubs) to match the board.

## League site sync

When **Sync to league site** is on (League settings), completing a rub **pair** (`groupsFor` groups such as boxes 0–1) enqueues a `POST` to `{base}/api/cards` (default base `http://127.0.0.1:47331`). Base URL is configurable; override with `?leagueBase=https://your-host` or `window.LEAGUE_API_BASE`. Offline updates sit in IndexedDB until the API is reachable. Cap: 100 successful POSTs per day.

## Deploy notes

`_headers` is included for hosts that honour it (for example Netlify): no-cache for HTML / SW / manifest, long-cache for fonts.

## Phone / live (Android + iPhone)

Static PWA (relative paths, service worker, web manifest). Temporary public HTTPS: serve on port 43127 and `cloudflared tunnel --url http://127.0.0.1:43127`.

- **Android:** open the HTTPS URL in **Chrome** → optional Install / Add to Home screen.
- **iPhone:** open in **Safari** → Share → **Add to Home Screen** (standalone install is Safari-only on iOS).
