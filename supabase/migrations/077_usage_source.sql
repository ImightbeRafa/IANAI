-- =============================================
-- Migration 077: Usage source (MCP vs web vs cron)
-- Tracks where an API call originated so admin activity can filter MCP vs web.
-- Existing rows remain NULL and display as web.
-- =============================================

ALTER TABLE public.api_usage_logs
  ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX IF NOT EXISTS idx_api_usage_logs_source
  ON public.api_usage_logs (source);

CREATE INDEX IF NOT EXISTS idx_api_usage_logs_source_created
  ON public.api_usage_logs (source, created_at DESC);

COMMENT ON COLUMN public.api_usage_logs.source IS
  'Origin of the call: mcp | web | cron. NULL treated as web for display/filter.';
