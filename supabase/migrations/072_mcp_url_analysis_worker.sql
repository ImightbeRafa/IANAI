-- GUIDE URL analysis worker support for mcp_url_intakes.

alter table public.mcp_url_intakes
  add column if not exists analysis_result jsonb null,
  add column if not exists warnings jsonb null default '[]'::jsonb,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists claimed_at timestamptz null,
  add column if not exists last_attempt_at timestamptz null,
  add column if not exists completed_at timestamptz null,
  add column if not exists applied_brand_kit_id uuid null references public.brand_kits (id) on delete set null;

create index if not exists mcp_url_intakes_queue_idx
  on public.mcp_url_intakes (status, created_at)
  where status in ('pending_analysis', 'processing');

-- One in-flight row per user+brand+url (pending or processing).
create unique index if not exists mcp_url_intakes_inflight_uniq
  on public.mcp_url_intakes (user_id, business_id, source_url)
  where status in ('pending_analysis', 'processing');

-- Atomically claim the oldest eligible row for the worker (service_role only).
create or replace function public.claim_mcp_url_intake(
  p_stale_after_seconds integer default 300
)
returns public.mcp_url_intakes
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.mcp_url_intakes;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;

  with candidate as (
    select id
    from public.mcp_url_intakes
    where status = 'pending_analysis'
       or (
         status = 'processing'
         and claimed_at is not null
         and claimed_at < now() - make_interval(secs => greatest(p_stale_after_seconds, 60))
       )
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.mcp_url_intakes i
  set
    status = 'processing',
    claimed_at = now(),
    last_attempt_at = now(),
    attempt_count = i.attempt_count + 1,
    updated_at = now(),
    error_message = null
  from candidate c
  where i.id = c.id
  returning i.* into claimed;

  return claimed;
end;
$$;

revoke all on function public.claim_mcp_url_intake(integer) from public;
revoke all on function public.claim_mcp_url_intake(integer) from anon;
revoke all on function public.claim_mcp_url_intake(integer) from authenticated;
grant execute on function public.claim_mcp_url_intake(integer) to service_role;

comment on function public.claim_mcp_url_intake(integer) is
  'MCP GUIDE worker: claim one pending/stale processing URL intake (service_role).';
