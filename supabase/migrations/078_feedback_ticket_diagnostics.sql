-- =============================================
-- Migration 078: Feedback ticket diagnostics
-- Extra privacy-safe context for admin triage (surface, locale, viewport, version).
-- page_url, browser_info, screen_size, console_errors already exist.
-- =============================================

ALTER TABLE public.feedback_tickets
  ADD COLUMN IF NOT EXISTS ui_surface text,
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS locale text,
  ADD COLUMN IF NOT EXISTS viewport text;

COMMENT ON COLUMN public.feedback_tickets.ui_surface IS
  'UI surface when the ticket was filed: chat (chat-shell /chat) | classic | other.';
COMMENT ON COLUMN public.feedback_tickets.app_version IS
  'Client app version at submit time.';
COMMENT ON COLUMN public.feedback_tickets.locale IS
  'UI locale at submit time (es | en).';
COMMENT ON COLUMN public.feedback_tickets.viewport IS
  'Viewport class at submit time: mobile | desktop.';
