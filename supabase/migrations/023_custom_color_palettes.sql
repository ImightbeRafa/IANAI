-- =============================================
-- Migration 023: Custom Color Palettes
-- Users can create their own 3-color palettes
-- =============================================

CREATE TABLE IF NOT EXISTS custom_color_palettes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'My Palette',
  color_1 TEXT NOT NULL,
  color_2 TEXT NOT NULL,
  color_3 TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_color_palettes_user ON custom_color_palettes(user_id);

ALTER TABLE custom_color_palettes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own palettes" ON custom_color_palettes
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create own palettes" ON custom_color_palettes
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own palettes" ON custom_color_palettes
  FOR DELETE USING (user_id = auth.uid());
