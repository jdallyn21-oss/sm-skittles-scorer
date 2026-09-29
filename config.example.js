/* Skittles Scorer — deploy / admin config template (Joe only).
 *
 * Prefer Vercel env: SUPABASE_URL + SUPABASE_ANON_KEY (build injects into config.js).
 * Or copy to config.js and fill supabaseAnonKey, then redeploy.
 * Players never configure anything — team PIN login only.
 *
 * Anon key: Supabase Dashboard → Project Settings → API → anon public
 * Never put service_role or the database password here.
 */
window.SKITTLES_CONFIG = {
  supabaseUrl: 'https://dtctorijynmcdjtzmgnk.supabase.co',
  supabaseAnonKey: '', // PASTE_ANON_KEY_HERE

  leagueSync: false,
  leagueBaseUrl: 'http://127.0.0.1:47331',

  rubs: 2,
  fines: true
};
