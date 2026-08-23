-- MCP EXECUTE approval tokens (server-only via service role).
-- TTL policy in app code: 1 hour. Store hashes only — never raw tokens.

create table if not exists public.mcp_approval_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  tool_name text not null,
  input_hash text not null,
  quoted_credit_cost numeric null,
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'expired', 'revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null
);

create index if not exists mcp_approval_tokens_user_id_idx
  on public.mcp_approval_tokens (user_id);

create index if not exists mcp_approval_tokens_expires_at_idx
  on public.mcp_approval_tokens (expires_at);

alter table public.mcp_approval_tokens enable row level security;

-- No policies for authenticated/anon — only service role (bypass RLS) may access.
revoke all on public.mcp_approval_tokens from anon, authenticated;
grant all on public.mcp_approval_tokens to service_role;

comment on table public.mcp_approval_tokens is
  'Single-use MCP EXECUTE approval tokens (hash only). App TTL = 1 hour.';
