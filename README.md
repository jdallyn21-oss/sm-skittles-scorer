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

## Quick game try-out

From the home (login) screen, **Start Quick game** opens a pins practice game with **no team PIN**. Choose 2–8 players a side, consecutive rubs **1** or **2** (South Molton default 2), name the sides, then the same **Score game** / **Mark scorecard** chooser. Type player names freely; recent names stay on the phone. Try-outs do **not** feed league tables or cloud sync. Use **Team login** to leave try-out mode.

## Played on (back matches)

On a match card, **Played on** lets scorers set the night the game was actually played when it differs from the fixture schedule. Shown on the card, All fixtures (when different), the result PDF, and the sync payload (`playedOn` / `playedOnDate`).

## Clear a wrong or test card

**Clear** is only for **current/upcoming** fixtures or **accidental in-progress** drafts. Once a result is **settled in the past** (submitted with play/schedule date before today, or a past scoreline with no draft), Clear is locked.

Where Clear still shows:

1. On the open card — **Clear this card** near the top (also under Finish).
2. On **All fixtures** — **Clear** beside eligible In progress / same-night rows.
3. On the Next match hero when a card is open and Clear is allowed.

Confirm the dialog. That wipes the phone card, fixtures scoreline overlay, and (for league fixtures) calls Supabase `skittles_delete_card`.

Quick Match / try-out: use **Delete** on the fixtures list (phone only).

Maintainer: run `supabase/migrations/20261121190000_skittles_delete_card.sql` in the Supabase SQL editor once. Until that RPC exists, Clear still wipes the phone and fixtures list; league remove will fail with a message until the SQL is applied. To force-remove a stuck row now:

```sql
select card_key, payload->>'status', updated_at from public.match_cards order by updated_at desc;
delete from public.match_cards where card_key = 'DIV-WEEK-MI';  -- e.g. '0-9-0'
```

## Score game vs Mark scorecard

On a fixture (and when starting a Quick Match / Cup or Quick game try-out), scorers choose how to enter scores. **Score game** is the primary option:

- **Score game** — live score-as-you-go, rub by rub while they play (existing flow).
- **Mark scorecard** — after play, enter **one evening total per player** (not rub-by-rub). Both sides stay visible. Use **Notes (special scores)** for 27s and similar. Finish, chalkboard photo, captain signatures, PDF, and submit/sync use the same path as live scoring. The evening total is mirrored into the sync payload so league pin totals still add up.

League fixtures still feed league tables; Quick Matches / cups / try-outs do not. Team PIN only for real teams — no admin setup for scorers.

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

On a completed match card (submitted, or fully ready to submit), use **Share result PDF** to open the phone share sheet with a PDF of the scores, or **Download PDF** to save the file. Works offline for league fixtures and Quick Matches. Live **Score game** PDFs keep the card’s line up and use **Rub Score** (then Each rub, when double rubs). **Mark scorecard** PDFs list player evening totals only (plus notes).

## Live URL

**Production:** [https://skittlesscorer.vercel.app](https://skittlesscorer.vercel.app/) — spelling **skittless** (two s).  
Typo `skittlescorer.vercel.app` (one s) 404s. Keep Deployment Protection **off** for Production so phones open without a Vercel login.

## Fines

Fines are **on by default**. On a match card, scorers can toggle **Mark fines** — that shows a Fine button on the score pad and a brass corner mark on the box (display only; score unchanged). Marked fines also appear as `*` next to the score on the result PDF. Deploy default: `config.js` → `fines: true` (or Vercel env `FINES=false` to default off).

## Supabase (shared team data) — admin deploy

Scorers only enter a **team PIN**. Backend config is maintainer-only:

- Default URL: `https://dtctorijynmcdjtzmgnk.supabase.co`
- **Vercel (preferred):** Project → Settings → Environment Variables → `SUPABASE_URL` + `SUPABASE_ANON_KEY` (anon public JWT). Build runs `npm run build` → `scripts/inject-config.js` writes `config.js`. Plain static JS cannot read Vercel env at runtime without this inject.
- **Or** paste the anon key into committed `config.js` (never `service_role` / DB password)
- Run SQL in `supabase/migrations/` then `supabase/seed_teams.sql` in the Supabase SQL editor (Joe only)

## League stats

After login, **League stats** (next to **Log out**) opens the league website in a new browser tab: [https://smskittles.vercel.app/](https://smskittles.vercel.app/). Scorer: [https://skittlesscorer.vercel.app/](https://skittlesscorer.vercel.app/).

## League site sync (optional, after Supabase)

Also admin-only via `config.js` (`leagueSync`, `leagueBaseUrl`). When enabled, completing a rub **pair** enqueues `POST {base}/api/cards`. Cap: 100 POSTs/day.

## Deploy notes

`_headers` is included for hosts that honour it (for example Netlify): no-cache for HTML / SW / manifest, long-cache for fonts.

## Phone / live (Android + iPhone)

Static PWA (relative paths, service worker, web manifest). Temporary public HTTPS: serve on port 43127 and `cloudflared tunnel --url http://127.0.0.1:43127`.

- **Android:** open the HTTPS URL in **Chrome** → optional Install / Add to Home screen.
- **iPhone:** open in **Safari** → Share → **Add to Home Screen** (standalone install is Safari-only on iOS).
