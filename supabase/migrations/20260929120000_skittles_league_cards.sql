-- Public league scoreboard read. No team PIN.
-- Run this whole file in the Supabase SQL editor for project dtctorijynmcdjtzmgnk
-- (Dashboard → SQL → New query → paste → Run).
--
-- Does not change skittles_pull, skittles_upsert_card, or the deny-all table policies.
-- Tables stay locked. This function is SECURITY DEFINER and returns league scores only:
--   * quick is unset (not true / 1, and the key is not qm- or quick-)
--   * format is league or omitted
--   * cups are left out (western-counties, sid-squire, pidler, front-pin, concrete,
--     and any other non-league format)
--   * a card with no numeric box yet is left out, so a blank draft does not wipe
--     a result already on the league site
-- No PINs, no photos, no signatures.

create or replace function public.skittles_league_cards()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      c.card_key,
      c.updated_at,
      c.payload,
      coalesce(
        case when c.payload->>'div' ~ '^[0-2]$' then (c.payload->>'div')::int end,
        case when c.card_key ~ '^[0-2]-[0-9]+-[0-9]+$' then split_part(c.card_key, '-', 1)::int end
      ) as div_index,
      coalesce(
        case when c.payload->>'week' ~ '^[0-9]+$' then (c.payload->>'week')::int end,
        case when c.card_key ~ '^[0-2]-[0-9]+-[0-9]+$' then split_part(c.card_key, '-', 2)::int end
      ) as week,
      coalesce(
        case when coalesce(c.payload->>'mi', c.payload->>'matchIndex') ~ '^[0-9]+$'
          then coalesce(c.payload->>'mi', c.payload->>'matchIndex')::int end,
        case when c.card_key ~ '^[0-2]-[0-9]+-[0-9]+$' then split_part(c.card_key, '-', 3)::int end
      ) as match_index,
      coalesce(
        case when coalesce(c.payload->>'home', c.payload->>'homeNum') ~ '^[0-9]+$'
          then coalesce(c.payload->>'home', c.payload->>'homeNum')::int end,
        case when split_part(c.home_team_key, '-', 2) ~ '^[0-9]+$'
          then split_part(c.home_team_key, '-', 2)::int end
      ) as home_num,
      coalesce(
        case when coalesce(c.payload->>'away', c.payload->>'awayNum') ~ '^[0-9]+$'
          then coalesce(c.payload->>'away', c.payload->>'awayNum')::int end,
        case when split_part(c.away_team_key, '-', 2) ~ '^[0-9]+$'
          then split_part(c.away_team_key, '-', 2)::int end
      ) as away_num,
      case
        when jsonb_typeof(c.payload->'players'->'home') = 'array' then c.payload->'players'->'home'
        else '[]'::jsonb
      end as home_players,
      case
        when jsonb_typeof(c.payload->'players'->'away') = 'array' then c.payload->'players'->'away'
        else '[]'::jsonb
      end as away_players
    from public.match_cards c
    where coalesce(c.payload->>'quick', 'false') not in ('true', '1')
      and c.card_key !~ '^(qm-|quick-)'
      and coalesce(c.payload->>'key', '') !~ '^(qm-|quick-)'
      and coalesce(nullif(c.payload->>'format', ''), 'league') = 'league'
  ),
  scored as (
    select b.*
    from base b
    where b.div_index is not null
      and b.week is not null
      and b.match_index is not null
      and b.home_num is not null
      and b.away_num is not null
      and exists (
        select 1
        from jsonb_array_elements(b.home_players || b.away_players) as p(player)
        cross join lateral jsonb_array_elements(coalesce(p.player->'boxes', '[]'::jsonb)) as box(value)
        where jsonb_typeof(box.value) = 'number'
      )
  )
  select coalesce(jsonb_agg(to_jsonb(card) order by card."divIndex", card.week, card."matchIndex"), '[]'::jsonb)
  from (
    select
      s.card_key as id,
      s.div_index as "divIndex",
      s.week,
      s.match_index as "matchIndex",
      s.home_num as "homeNum",
      s.away_num as "awayNum",
      'league'::text as format,
      false as quick,
      to_char(s.updated_at at time zone 'Europe/London', 'YYYY-MM-DD') as "savedAt",
      home.players as "homePlayers",
      away.players as "awayPlayers",
      home.total as "homeTotal",
      away.total as "awayTotal"
    from scored s
    cross join lateral (
      select
        coalesce(jsonb_agg(jsonb_build_object('name', named.name, 'pins', named.pins) order by named.ord), '[]'::jsonb) as players,
        coalesce(sum(named.pins), 0)::int as total
      from (
        select
          t.ord,
          trim(t.player->>'name') as name,
          (
            select coalesce(sum((box.value #>> '{}')::numeric), 0)::int
            from jsonb_array_elements(coalesce(t.player->'boxes', '[]'::jsonb)) as box(value)
            where jsonb_typeof(box.value) = 'number'
          ) as pins
        from jsonb_array_elements(s.home_players) with ordinality as t(player, ord)
        where coalesce(trim(t.player->>'name'), '') <> ''
      ) named
    ) home
    cross join lateral (
      select
        coalesce(jsonb_agg(jsonb_build_object('name', named.name, 'pins', named.pins) order by named.ord), '[]'::jsonb) as players,
        coalesce(sum(named.pins), 0)::int as total
      from (
        select
          t.ord,
          trim(t.player->>'name') as name,
          (
            select coalesce(sum((box.value #>> '{}')::numeric), 0)::int
            from jsonb_array_elements(coalesce(t.player->'boxes', '[]'::jsonb)) as box(value)
            where jsonb_typeof(box.value) = 'number'
          ) as pins
        from jsonb_array_elements(s.away_players) with ordinality as t(player, ord)
        where coalesce(trim(t.player->>'name'), '') <> ''
      ) named
    ) away
  ) card;
$$;

revoke all on function public.skittles_league_cards() from public;
grant execute on function public.skittles_league_cards() to anon, authenticated;
