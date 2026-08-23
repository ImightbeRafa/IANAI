-- Lightweight MCP workspace notes (provenance / file placeholders). No credits.

create table if not exists public.mcp_workspace_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null,
  note text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mcp_workspace_notes_user_brand_idx
  on public.mcp_workspace_notes (user_id, business_id, created_at desc);

alter table public.mcp_workspace_notes enable row level security;

create policy "Users can view own mcp workspace notes"
  on public.mcp_workspace_notes for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own mcp workspace notes"
  on public.mcp_workspace_notes for insert to authenticated
  with check (auth.uid() = user_id);

revoke all on public.mcp_workspace_notes from anon;
grant select, insert on public.mcp_workspace_notes to authenticated;
grant all on public.mcp_workspace_notes to service_role;
