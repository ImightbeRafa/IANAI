-- MCP e2e: approval result replay + workspace note updates for intake completion.

alter table public.mcp_approval_tokens
  add column if not exists result_json jsonb null,
  add column if not exists result_stored_at timestamptz null;

comment on column public.mcp_approval_tokens.result_json is
  'Compact EXECUTE result for idempotent replay after consume (no large base64).';

drop policy if exists "Users can update own mcp workspace notes" on public.mcp_workspace_notes;
create policy "Users can update own mcp workspace notes"
  on public.mcp_workspace_notes for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant update on public.mcp_workspace_notes to authenticated;
