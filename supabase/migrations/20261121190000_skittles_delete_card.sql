-- Delete a match card (and cascaded media) so it leaves skittles_league_cards / league site.
-- PIN-gated: caller must be home or away on the card. Idempotent if already gone.
-- Run in Supabase SQL editor for project dtctorijynmcdjtzmgnk after team sync is live.

create or replace function public.skittles_delete_card(
  p_team_key text,
  p_pin text,
  p_card_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_key text;
begin
  if not public.skittles_verify_pin(p_team_key, p_pin) then
    raise exception 'invalid team or PIN' using errcode = '42501';
  end if;

  delete from public.match_cards c
  where c.card_key = p_card_key
    and (c.home_team_key = p_team_key or c.away_team_key = p_team_key)
  returning c.card_key into deleted_key;

  -- Missing row is OK (already cleared elsewhere)
  return jsonb_build_object(
    'card_key', p_card_key,
    'deleted', deleted_key is not null
  );
end;
$$;

revoke all on function public.skittles_delete_card(text, text, text) from public;
grant execute on function public.skittles_delete_card(text, text, text) to anon, authenticated;
