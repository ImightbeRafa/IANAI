-- Extend MCP approval tokens for web Approve → approved → consume flow.

alter table public.mcp_approval_tokens
  drop constraint if exists mcp_approval_tokens_status_check;

alter table public.mcp_approval_tokens
  add constraint mcp_approval_tokens_status_check
  check (status in ('pending', 'approved', 'denied', 'consumed', 'expired', 'revoked'));

alter table public.mcp_approval_tokens
  add column if not exists input_json jsonb null,
  add column if not exists approved_at timestamptz null,
  add column if not exists denied_at timestamptz null;

comment on table public.mcp_approval_tokens is
  'MCP EXECUTE approvals: pending → (web) approved → consumed. Hash only; 1h TTL.';
