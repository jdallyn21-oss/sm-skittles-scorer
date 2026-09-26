# Supabase setup for Skittles Scorer

1. Dashboard → project **dtctorijynmcdjtzmgnk** → SQL editor.
2. Run `migrations/20260926120000_skittles_team_sync.sql`.
3. Run `seed_teams.sql`.
4. Settings → API → copy **anon public** key into the PWA League settings (or `?supabaseAnon=`).

PWA API URL (default): `https://dtctorijynmcdjtzmgnk.supabase.co`  
Do **not** put the database password or `service_role` key in the app or in git.
