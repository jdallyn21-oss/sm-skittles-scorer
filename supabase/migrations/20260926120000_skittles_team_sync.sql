-- Skittles Scorer — shared team data (PIN-gated RPCs)
-- Run this in the Supabase SQL editor (or via supabase db push).
-- Then run supabase/seed_teams.sql to load team keys/PINs from the app seed.

-- ---------------------------------------------------------------------------
-- Threat model (read before enabling)
-- ---------------------------------------------------------------------------
-- * The browser holds the Supabase anon key (public by design) and the team PIN
--   after login (shared secret among that team’s scorers).
-- * Anyone who knows BOTH the anon key (from the shipped app) and a team PIN
--   can pull/upsert that team’s match cards via the RPCs below.
-- * Tables are locked to anon/authenticated; all access is SECURITY DEFINER
--   RPCs that re-check the PIN on every call. Never put the service_role key
--   in the PWA or commit it to git.
-- * PINs are stored in plaintext here to match the existing on-device PIN model.
--   Prefer migrating to crypt() hashes before a wide public launch.

create extension if not exists pgcrypto;

create table if not exists public.teams (
  team_key text primary key,          -- e.g. '0-1' (divIndex-teamNum), matches SEED.logins
  pin text not null,
  name text,
  division int,
  team_num int,
  created_at timestamptz not null default now()
);

create table if not exists public.match_cards (
  card_key text primary key,          -- local card.key (fixture or qm-…)
  home_team_key text not null references public.teams(team_key),
  away_team_key text not null references public.teams(team_key),
  payload jsonb not null,             -- full card object (scores, lineup, flags)
  updated_at timestamptz not null default now(),
  updated_by_team text references public.teams(team_key),
  revision bigint not null default 1
);

create index if not exists match_cards_home_idx on public.match_cards (home_team_key);
create index if not exists match_cards_away_idx on public.match_cards (away_team_key);
create index if not exists match_cards_updated_idx on public.match_cards (updated_at desc);

-- Optional binary media (chalkboard photo / captain signatures) as bytea.
-- Large images: consider Storage later; bytea keeps restore simple for v1.
create table if not exists public.card_media (
  card_key text not null references public.match_cards(card_key) on delete cascade,
  kind text not null check (kind in ('photo', 'sig_home', 'sig_away')),
  content_type text not null default 'application/octet-stream',
  data bytea not null,
  updated_at timestamptz not null default now(),
  primary key (card_key, kind)
);

alter table public.teams enable row level security;
alter table public.match_cards enable row level security;
alter table public.card_media enable row level security;

-- Deny direct table access from anon/authenticated; RPCs are SECURITY DEFINER.
drop policy if exists teams_deny_all on public.teams;
create policy teams_deny_all on public.teams for all using (false) with check (false);

drop policy if exists match_cards_deny_all on public.match_cards;
create policy match_cards_deny_all on public.match_cards for all using (false) with check (false);

drop policy if exists card_media_deny_all on public.card_media;
create policy card_media_deny_all on public.card_media for all using (false) with check (false);

grant usage on schema public to anon, authenticated;

create or replace function public.skittles_verify_pin(p_team_key text, p_pin text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.teams t
    where t.team_key = p_team_key and t.pin = p_pin
  );
$$;

create or replace function public.skittles_pull(
  p_team_key text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.skittles_verify_pin(p_team_key, p_pin) then
    raise exception 'invalid team or PIN' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'card_key', c.card_key,
      'home_team_key', c.home_team_key,
      'away_team_key', c.away_team_key,
      'payload', c.payload,
      'updated_at', c.updated_at,
      'updated_by_team', c.updated_by_team,
      'revision', c.revision,
      'media', coalesce((
        select jsonb_object_agg(m.kind, jsonb_build_object(
          'content_type', m.content_type,
          'data_base64', encode(m.data, 'base64'),
          'updated_at', m.updated_at
        ))
        from public.card_media m where m.card_key = c.card_key
      ), '{}'::jsonb)
    )
    order by c.updated_at desc
  ), '[]'::jsonb)
  into result
  from public.match_cards c
  where c.home_team_key = p_team_key or c.away_team_key = p_team_key;

  return result;
end;
$$;

create or replace function public.skittles_upsert_card(
  p_team_key text,
  p_pin text,
  p_card_key text,
  p_home_team_key text,
  p_away_team_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.match_cards;
begin
  if not public.skittles_verify_pin(p_team_key, p_pin) then
    raise exception 'invalid team or PIN' using errcode = '42501';
  end if;

  if p_team_key is distinct from p_home_team_key
     and p_team_key is distinct from p_away_team_key then
    raise exception 'team is not a participant on this card' using errcode = '42501';
  end if;

  insert into public.match_cards as mc (
    card_key, home_team_key, away_team_key, payload, updated_at, updated_by_team, revision
  ) values (
    p_card_key, p_home_team_key, p_away_team_key, p_payload, now(), p_team_key, 1
  )
  on conflict (card_key) do update set
    home_team_key = excluded.home_team_key,
    away_team_key = excluded.away_team_key,
    payload = excluded.payload,
    updated_at = now(),
    updated_by_team = excluded.updated_by_team,
    revision = mc.revision + 1
  where mc.home_team_key = p_team_key or mc.away_team_key = p_team_key
  returning * into row;

  if row.card_key is null then
    raise exception 'upsert denied' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'card_key', row.card_key,
    'updated_at', row.updated_at,
    'revision', row.revision
  );
end;
$$;

create or replace function public.skittles_upsert_media(
  p_team_key text,
  p_pin text,
  p_card_key text,
  p_kind text,
  p_content_type text,
  p_data_base64 text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  if not public.skittles_verify_pin(p_team_key, p_pin) then
    raise exception 'invalid team or PIN' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.match_cards c
    where c.card_key = p_card_key
      and (c.home_team_key = p_team_key or c.away_team_key = p_team_key)
  ) into ok;

  if not ok then
    raise exception 'card not found or not permitted' using errcode = '42501';
  end if;

  if p_kind not in ('photo', 'sig_home', 'sig_away') then
    raise exception 'invalid media kind';
  end if;

  insert into public.card_media (card_key, kind, content_type, data, updated_at)
  values (
    p_card_key,
    p_kind,
    coalesce(nullif(p_content_type, ''), 'application/octet-stream'),
    decode(p_data_base64, 'base64'),
    now()
  )
  on conflict (card_key, kind) do update set
    content_type = excluded.content_type,
    data = excluded.data,
    updated_at = now();

  return jsonb_build_object('card_key', p_card_key, 'kind', p_kind, 'ok', true);
end;
$$;

grant execute on function public.skittles_verify_pin(text, text) to anon, authenticated;
grant execute on function public.skittles_pull(text, text) to anon, authenticated;
grant execute on function public.skittles_upsert_card(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.skittles_upsert_media(text, text, text, text, text, text) to anon, authenticated;
