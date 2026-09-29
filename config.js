/* Skittles Scorer — deploy / admin config (Joe / maintainer only).
 * Players never see or edit this.
 *
 * On Vercel: set SUPABASE_URL + SUPABASE_ANON_KEY in Project → Environment Variables.
 * `npm run build` (scripts/inject-config.js) writes those into this file at deploy.
 * Locally / without env: paste anon key here, or leave empty until Vercel injects it.
 *
 * Anon key: Supabase Dashboard → Project Settings → API → anon public
 * Never put service_role or the database password here.
 */
window.SKITTLES_CONFIG = {
  supabaseUrl: 'https://dtctorijynmcdjtzmgnk.supabase.co',
  supabaseAnonKey: '', // PASTE_ANON_KEY_HERE (or set SUPABASE_ANON_KEY on Vercel)

  // Optional league site /api/cards (after Supabase). Off until Joe enables it.
  leagueSync: false,
  leagueBaseUrl: 'http://127.0.0.1:47331',

  // Match rules baked into the deploy (South Molton = double rubs)
  rubs: 2,
  // Fines on by default — scorers can toggle per match on the card
  fines: true
};
