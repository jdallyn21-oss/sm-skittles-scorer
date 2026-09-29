# Supabase setup (Joe / maintainer only)

Scorers never configure Supabase. They only enter a team PIN.

1. Dashboard → project **dtctorijynmcdjtzmgnk** → SQL editor.
2. Run `migrations/20260926120000_skittles_team_sync.sql` (already applied if teams and `match_cards` exist).
3. Run `seed_teams.sql` if team PINs are not loaded yet.
4. Run `migrations/20260929120000_skittles_league_cards.sql`. That adds `skittles_league_cards()` — a PIN-free read of league fixtures only. It does not change `skittles_pull`. Paste the whole file into a new SQL query and run it.
5. Settings → API → the anon key stays in Vercel as `SUPABASE_ANON_KEY` (injected at deploy). Do not commit it.

PWA API URL (in `config.js`): `https://dtctorijynmcdjtzmgnk.supabase.co`  
Do **not** put the database password or `service_role` in the app or in git.
