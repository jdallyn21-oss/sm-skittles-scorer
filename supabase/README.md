# Supabase setup (Joe / maintainer only)

Scorers never configure Supabase. They only enter a team PIN.

## Live diagnosis (2026-09-29)

| Check | Result |
|-------|--------|
| Vercel `config.js` inject | OK — URL + anon JWT present on skittlesscorer.vercel.app |
| CORS | OK |
| `skittles_pull` / `skittles_upsert_card` | Functions exist |
| `skittles_verify_pin('0-1','7835')` (and all other seed PINs) | **`false`** → `teams` table empty / not seeded |
| `skittles_league_cards()` | **Missing** (PGRST202) |

**Cloud sync cannot work until step 3 below is run.** App code and anon key are fine.

## Exact steps (SQL editor)

1. Dashboard → project **dtctorijynmcdjtzmgnk** → SQL → New query.
2. If not already done: run `migrations/20260926120000_skittles_team_sync.sql` (already applied if RPCs exist).
3. **Required now:** run `seed_teams.sql` (loads all 27 team PINs into `public.teams`).
4. **For league site feed:** run `migrations/20260929120000_skittles_league_cards.sql` (adds PIN-free `skittles_league_cards()`).
5. Verify in SQL: `select public.skittles_verify_pin('0-1','7835');` → should be `true`.
6. Verify: `select public.skittles_league_cards();` → JSON array (may be empty until cards are scored).
7. Vercel env already has `SUPABASE_URL` + `SUPABASE_ANON_KEY` (injected at deploy). No change needed unless the anon key was rotated.

After step 3, scorers log out and back in on [skittlesscorer.vercel.app](https://skittlesscorer.vercel.app/) — phone sync banner should turn green.

PWA API URL (in `config.js`): `https://dtctorijynmcdjtzmgnk.supabase.co`  
Do **not** put the database password or `service_role` in the app or in git.
