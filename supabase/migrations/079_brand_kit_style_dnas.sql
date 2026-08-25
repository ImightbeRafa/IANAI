-- =============================================
-- Migration 079: Style DNA on brand kits
-- Unlimited JSON list for organic/ads visual DNA used by bulk posts.
-- =============================================

ALTER TABLE public.brand_kits
  ADD COLUMN IF NOT EXISTS style_dnas jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.brand_kits.style_dnas IS
  'Array of { id, name, kind: organic|ads, referenceUrls[], notes }. Used by bulk posts / MCP.';
