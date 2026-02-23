-- =============================================
-- Migration 042: Script Edit Tracking
-- Adds columns to track edit source, link scripts
-- to their originating chat message, and enable
-- restoring edit history on page reload.
-- =============================================

-- 1) edit_source: 'original' | 'manual' | 'enhance' | 'hook' | 'consciousness'
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS edit_source TEXT;

-- 2) Link to the originating message so we can match
--    parsed scripts back to their saved records on reload
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS script_index INTEGER;

-- 3) Optional label for hook/consciousness edits (e.g. "Definición directa", "Frío")
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS edit_label TEXT;

-- Index for fast lookup by message_id
CREATE INDEX IF NOT EXISTS idx_scripts_message ON scripts(message_id) WHERE message_id IS NOT NULL;
