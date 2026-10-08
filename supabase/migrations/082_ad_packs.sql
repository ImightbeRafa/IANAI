-- Migration 082: Ad Pack engine — packs + per-ad items (durable state machine).
-- Writes only via service_role (api/lib/adpack/store-supabase.ts). Users can read their own rows.

create table if not exists public.ad_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid,
  brand_kit_id uuid,
  status text not null default 'planned'
    check (status in ('planned', 'running', 'done', 'partial', 'failed', 'cancelled')),
  size integer not null check (size between 1 and 20),
  ratios text[] not null default array['1:1', '4:5', '9:16'],
  quoted_credits integer not null default 0,
  source text not null default 'web' check (source in ('web', 'mcp')),
  dna jsonb not null default '{}'::jsonb,
  offer jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_packs_user_created_idx
  on public.ad_packs (user_id, created_at desc);

create table if not exists public.ad_pack_items (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.ad_packs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  item_index integer not null check (item_index >= 0),
  status text not null default 'planned'
    check (status in ('planned', 'copy_ready', 'scene_ready', 'rendered', 'done', 'failed')),
  angle jsonb not null,
  ad_copy jsonb,
  copy_check jsonb,
  scene jsonb,
  scene_check jsonb,
  renders jsonb not null default '[]'::jsonb,
  attempts integer not null default 0,
  error text,
  generation_id uuid not null unique,
  lease_until timestamptz,
  cost_usd numeric(10, 6) not null default 0,
  timings jsonb,
  scene_attempts integer,
  charged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pack_id, item_index)
);

create index if not exists ad_pack_items_pack_idx
  on public.ad_pack_items (pack_id, item_index);
create index if not exists ad_pack_items_user_idx
  on public.ad_pack_items (user_id, created_at desc);
create index if not exists ad_pack_items_pending_idx
  on public.ad_pack_items (pack_id, lease_until)
  where status not in ('done', 'failed');

-- RLS: authenticated users read their own rows; all writes go through service_role.
alter table public.ad_packs enable row level security;
alter table public.ad_pack_items enable row level security;

create policy "Users can view own ad packs"
  on public.ad_packs for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can view own ad pack items"
  on public.ad_pack_items for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.ad_packs from anon, authenticated;
revoke all on public.ad_pack_items from anon, authenticated;
grant select on public.ad_packs to authenticated;
grant select on public.ad_pack_items to authenticated;
grant all on public.ad_packs to service_role;
grant all on public.ad_pack_items to service_role;

-- Atomic leasing: up to p_limit unfinished, unleased (or expired) items, lowest index first.
create or replace function public.adpack_lease_items(
  p_pack_id uuid,
  p_limit integer,
  p_lease_ms integer,
  p_exclude uuid[] default '{}'::uuid[]
)
returns setof public.ad_pack_items
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select i.id
      from public.ad_pack_items i
     where i.pack_id = p_pack_id
       and i.status not in ('done', 'failed')
       and (i.lease_until is null or i.lease_until < now())
       and not (i.id = any (coalesce(p_exclude, '{}'::uuid[])))
     order by i.item_index
     limit greatest(coalesce(p_limit, 0), 0)
     for update skip locked
  )
  update public.ad_pack_items u
     set lease_until = now() + make_interval(secs => greatest(coalesce(p_lease_ms, 0), 0) / 1000.0),
         updated_at = now()
    from picked
   where u.id = picked.id
  returning u.*;
end;
$$;

revoke all on function public.adpack_lease_items(uuid, integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.adpack_lease_items(uuid, integer, integer, uuid[]) to service_role;
