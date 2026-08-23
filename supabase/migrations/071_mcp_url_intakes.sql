-- GUIDE URL intake rows (pending analysis; no credits).
-- Used by MCP workspace_save_url_context.

create table if not exists public.mcp_url_intakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  source_url text not null,
  status text not null default 'pending_analysis'
    check (status in ('pending_analysis', 'processing', 'ready', 'failed')),
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mcp_url_intakes_user_id_idx
  on public.mcp_url_intakes (user_id);

create index if not exists mcp_url_intakes_business_id_idx
  on public.mcp_url_intakes (business_id);

alter table public.mcp_url_intakes enable row level security;

create policy "Users can view own mcp url intakes"
  on public.mcp_url_intakes
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own mcp url intakes"
  on public.mcp_url_intakes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

revoke all on public.mcp_url_intakes from anon;
grant select, insert on public.mcp_url_intakes to authenticated;
grant all on public.mcp_url_intakes to service_role;

comment on table public.mcp_url_intakes is
  'MCP GUIDE URL intake queue. pending_analysis until a worker analyzes (no credits on insert).';
