-- Créditos IA wallet (lots + ledger + RPCs).
-- Policy: monthly unused → gone at grant; pack credits expire in 12 months.
-- See docs/operations/credits-ia-aiian.md

-- Plan capability columns (keep legacy usage columns for shadow period)
alter table public.plan_limits
  add column if not exists credits_per_month integer,
  add column if not exists kits_max integer,
  add column if not exists products_per_kit_max integer,
  add column if not exists is_hidden boolean not null default false,
  add column if not exists grant_once boolean not null default false;

comment on column public.plan_limits.credits_per_month is
  'Monthly Créditos IA allotment; Free uses grant_once welcome instead.';

-- Profile: welcome grant stamp + stop relying on bonus_images after migration
alter table public.profiles
  add column if not exists welcome_credits_granted_at timestamptz null;

create table if not exists public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'monthly', 'rollover', 'pack', 'welcome', 'bonus_migration', 'comp'
  )),
  granted integer not null check (granted >= 0),
  remaining integer not null check (remaining >= 0),
  expires_at timestamptz null,
  period_start date null,
  created_at timestamptz not null default now()
);

create index if not exists credit_lots_user_remaining_idx
  on public.credit_lots (user_id, expires_at)
  where remaining > 0;

create table if not exists public.credit_ledger (
  generation_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  units integer not null default 1,
  credits integer not null,
  lot_deltas jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_created_idx
  on public.credit_ledger (user_id, created_at desc);

alter table public.credit_lots enable row level security;
alter table public.credit_ledger enable row level security;

drop policy if exists "Users read own credit lots" on public.credit_lots;
create policy "Users read own credit lots"
  on public.credit_lots for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users read own credit ledger" on public.credit_ledger;
create policy "Users read own credit ledger"
  on public.credit_ledger for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.credit_lots from anon, authenticated;
revoke all on public.credit_ledger from anon, authenticated;
grant select on public.credit_lots to authenticated;
grant select on public.credit_ledger to authenticated;
grant all on public.credit_lots to service_role;
grant all on public.credit_ledger to service_role;

-- Update catalog columns on existing plans (do not wipe usage columns)
update public.plan_limits set credits_per_month = 0, kits_max = 1, products_per_kit_max = 3, is_hidden = false, grant_once = true where plan = 'free';
update public.plan_limits set credits_per_month = 750, kits_max = 2, products_per_kit_max = 10, is_hidden = false, grant_once = false where plan = 'starter';
update public.plan_limits set credits_per_month = 1500, kits_max = 5, products_per_kit_max = 25, is_hidden = false, grant_once = false where plan = 'pro';
update public.plan_limits set credits_per_month = 600, kits_max = 5, products_per_kit_max = 25, is_hidden = true, grant_once = false where plan = 'meta_advanze';
update public.plan_limits set credits_per_month = 9600, kits_max = 50, products_per_kit_max = 500, is_hidden = true, grant_once = false where plan = 'enterprise';

-- Allow Business plan id on plan_limits
alter table public.plan_limits drop constraint if exists plan_limits_plan_check;
alter table public.plan_limits add constraint plan_limits_plan_check
  check (plan = any (array['free'::text, 'starter'::text, 'pro'::text, 'business'::text, 'enterprise'::text, 'meta_advanze'::text]));

-- Business is NEW — insert only if missing (copy numeric shape from pro as shadow defaults)
insert into public.plan_limits (
  plan, scripts_per_month, images_per_month, descriptions_per_month, replies_per_month,
  max_team_members, max_clients, max_products, brand_kits_max,
  credits_per_month, kits_max, products_per_kit_max, is_hidden, grant_once,
  price_monthly
)
select
  'business', 1600, 200, 1600, 1600,
  10, 50, 500, 20,
  4800, 20, 100, false, false,
  149
where not exists (select 1 from public.plan_limits where plan = 'business');

-- Atomic consume (service_role only)
create or replace function public.consume_credits(
  p_user_id uuid,
  p_action text,
  p_generation_id uuid,
  p_credits integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing record;
  need int := greatest(p_credits, 0);
  rem int;
  lot record;
  deltas jsonb := '[]'::jsonb;
  take int;
begin
  if p_user_id is null or p_generation_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_args');
  end if;

  select * into existing from public.credit_ledger where generation_id = p_generation_id;
  if found then
    select coalesce(sum(remaining), 0)::int into rem
    from public.credit_lots
    where user_id = p_user_id
      and remaining > 0
      and (expires_at is null or expires_at > now());
    return jsonb_build_object(
      'ok', true,
      'already_charged', true,
      'credits', existing.credits,
      'remaining', rem
    );
  end if;

  if need = 0 then
    select coalesce(sum(remaining), 0)::int into rem
    from public.credit_lots
    where user_id = p_user_id
      and remaining > 0
      and (expires_at is null or expires_at > now());
    return jsonb_build_object('ok', true, 'credits', 0, 'remaining', rem);
  end if;

  select coalesce(sum(remaining), 0)::int into rem
  from public.credit_lots
  where user_id = p_user_id
    and remaining > 0
    and (expires_at is null or expires_at > now());

  if rem < need then
    return jsonb_build_object('ok', false, 'remaining', rem, 'required', need);
  end if;

  for lot in
    select *
    from public.credit_lots
    where user_id = p_user_id
      and remaining > 0
      and (expires_at is null or expires_at > now())
    order by
      case kind
        when 'monthly' then 1
        when 'rollover' then 2
        when 'welcome' then 3
        when 'bonus_migration' then 4
        when 'comp' then 5
        when 'pack' then 6
        else 9
      end,
      expires_at nulls last,
      created_at
    for update
  loop
    exit when need <= 0;
    take := least(lot.remaining, need);
    update public.credit_lots set remaining = remaining - take where id = lot.id;
    need := need - take;
    deltas := deltas || jsonb_build_array(jsonb_build_object('lotId', lot.id, 'delta', -take));
  end loop;

  insert into public.credit_ledger (generation_id, user_id, action, units, credits, lot_deltas)
  values (p_generation_id, p_user_id, p_action, 1, p_credits, deltas);

  select coalesce(sum(remaining), 0)::int into rem
  from public.credit_lots
  where user_id = p_user_id
    and remaining > 0
    and (expires_at is null or expires_at > now());

  return jsonb_build_object('ok', true, 'credits', p_credits, 'remaining', rem, 'already_charged', false);
end;
$$;

revoke all on function public.consume_credits(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_credits(uuid, text, uuid, integer) to service_role;

create or replace function public.grant_welcome_credits(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.profiles
    where id = p_user_id and welcome_credits_granted_at is not null
  ) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  insert into public.credit_lots (user_id, kind, granted, remaining, expires_at)
  values (p_user_id, 'welcome', 150, 150, null);

  update public.profiles
  set welcome_credits_granted_at = now()
  where id = p_user_id
    and welcome_credits_granted_at is null;

  return jsonb_build_object('ok', true, 'credits', 150);
end;
$$;

revoke all on function public.grant_welcome_credits(uuid) from public, anon, authenticated;
grant execute on function public.grant_welcome_credits(uuid) to service_role;

create or replace function public.grant_pack_credits(p_user_id uuid, p_credits integer default 500, p_ttl_months integer default 12)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
begin
  insert into public.credit_lots (user_id, kind, granted, remaining, expires_at)
  values (
    p_user_id,
    'pack',
    greatest(p_credits, 0),
    greatest(p_credits, 0),
    now() + make_interval(months => greatest(p_ttl_months, 1))
  )
  returning id into cid;

  return jsonb_build_object('ok', true, 'lot_id', cid, 'credits', p_credits);
end;
$$;

revoke all on function public.grant_pack_credits(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.grant_pack_credits(uuid, integer, integer) to service_role;

create or replace function public.grant_monthly_credits(p_user_id uuid, p_plan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allotment int;
  period_end timestamptz := now() + interval '1 month';
  already int;
begin
  select coalesce(credits_per_month, 0) into allotment
  from public.plan_limits where plan = p_plan;

  if allotment is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_plan');
  end if;

  if allotment <= 0 then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  -- Idempotent: one monthly grant per calendar day (covers subscribe+payment double fire)
  select count(*)::int into already
  from public.credit_lots
  where user_id = p_user_id
    and kind = 'monthly'
    and period_start = current_date
    and remaining > 0;
  if already > 0 then
    return jsonb_build_object('ok', true, 'already', true, 'credits', allotment);
  end if;

  -- Expire dated lots
  update public.credit_lots
  set remaining = 0
  where user_id = p_user_id
    and remaining > 0
    and expires_at is not null
    and expires_at <= now();

  -- Unused monthly from prior period is gone (no rollover)
  update public.credit_lots set remaining = 0
  where user_id = p_user_id and kind = 'monthly';

  -- Legacy rollover lots also burn at renewal
  update public.credit_lots set remaining = 0
  where user_id = p_user_id and kind = 'rollover';

  insert into public.credit_lots (user_id, kind, granted, remaining, expires_at, period_start)
  values (p_user_id, 'monthly', allotment, allotment, period_end, current_date);

  return jsonb_build_object('ok', true, 'credits', allotment);
end;
$$;

revoke all on function public.grant_monthly_credits(uuid, text) from public, anon, authenticated;
grant execute on function public.grant_monthly_credits(uuid, text) to service_role;

-- One-shot: convert bonus_images → bonus_migration lots (24 credits each, no expiry)
create or replace function public.migrate_bonus_images_to_credits()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  total_users int := 0;
  total_credits int := 0;
  c int;
begin
  for r in
    select id, coalesce(bonus_images, 0) as bonus
    from public.profiles
    where coalesce(bonus_images, 0) > 0
  loop
    c := r.bonus * 24;
    insert into public.credit_lots (user_id, kind, granted, remaining, expires_at)
    values (r.id, 'bonus_migration', c, c, null);
    update public.profiles set bonus_images = 0 where id = r.id;
    total_users := total_users + 1;
    total_credits := total_credits + c;
  end loop;
  return jsonb_build_object('ok', true, 'users', total_users, 'credits', total_credits);
end;
$$;

revoke all on function public.migrate_bonus_images_to_credits() from public, anon, authenticated;
grant execute on function public.migrate_bonus_images_to_credits() to service_role;
