-- =============================================
-- Custom Post Types
-- Users can create their own post styles from reference images + text
-- =============================================

CREATE TABLE IF NOT EXISTS custom_post_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  reference_images TEXT[] DEFAULT '{}',
  master_prompt_es TEXT NOT NULL,
  master_prompt_en TEXT NOT NULL,
  style_preferences JSONB DEFAULT '{}',
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_custom_post_types_user_id ON custom_post_types(user_id);

-- RLS
ALTER TABLE custom_post_types ENABLE ROW LEVEL SECURITY;

-- Users can read their own custom post types
CREATE POLICY "Users can read own custom post types"
  ON custom_post_types FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own custom post types
CREATE POLICY "Users can create custom post types"
  ON custom_post_types FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own custom post types
CREATE POLICY "Users can update own custom post types"
  ON custom_post_types FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own custom post types
CREATE POLICY "Users can delete own custom post types"
  ON custom_post_types FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_custom_post_types_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_custom_post_types_updated_at
  BEFORE UPDATE ON custom_post_types
  FOR EACH ROW
  EXECUTE FUNCTION update_custom_post_types_updated_at();
