# Supabase setup (Joe / maintainer only)

Scorers never configure Supabase. They only enter a team PIN.

1. Dashboard → project **dtctorijynmcdjtzmgnk** → SQL editor.
2. Run `migrations/20260926120000_skittles_team_sync.sql`.
3. Run `seed_teams.sql`.
4. Settings → API → copy **anon public** into repo root **`config.js`** (`supabaseAnonKey`), then redeploy.

PWA API URL (in `config.js`): `https://dtctorijynmcdjtzmgnk.supabase.co`  
Do **not** put the database password or `service_role` in the app or in git.
