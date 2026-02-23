-- =============================================
-- Migration 044: Enhanced feedback ticket context
-- Adds richer diagnostic fields for better issue debugging
-- =============================================

-- 1. Add new context columns
ALTER TABLE feedback_tickets
  ADD COLUMN IF NOT EXISTS network_errors JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS breadcrumbs JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS product_id UUID,
  ADD COLUMN IF NOT EXISTS product_name TEXT,
  ADD COLUMN IF NOT EXISTS user_plan TEXT,
  ADD COLUMN IF NOT EXISTS notes_history JSONB DEFAULT '[]'::jsonb;
