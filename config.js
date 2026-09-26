/* Skittles Scorer — deploy / admin config (Joe / maintainer only).
 *
 * Players never see or edit this. Copy from config.example.js if needed.
 * Fill supabaseAnonKey once, commit/redeploy. Then scorers only use a team PIN.
 *
 * Anon key: Supabase Dashboard → Project Settings → API → anon public
 * Never put service_role or the database password here.
 */
window.SKITTLES_CONFIG = {
  supabaseUrl: 'https://dtctorijynmcdjtzmgnk.supabase.co',
  supabaseAnonKey: '', // PASTE_ANON_KEY_HERE

  // Optional league site /api/cards (after Supabase). Off until Joe enables it.
  leagueSync: false,
  leagueBaseUrl: 'http://127.0.0.1:47331',

  // Match rules baked into the deploy (South Molton = double rubs)
  rubs: 2,
  fines: false
};
