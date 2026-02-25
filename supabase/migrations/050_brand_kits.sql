-- =============================================
-- Migration 050: Brand Kits
-- Centralized brand identity that auto-applies
-- across scripts, posts, and replies.
-- =============================================

CREATE TABLE IF NOT EXISTS brand_kits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'My Brand',
  -- Visual identity
  logo_url TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  accent_color TEXT,
  -- Voice identity
  brand_voice TEXT,
  tone_keywords TEXT[] DEFAULT '{}',
  must_use_phrases TEXT[] DEFAULT '{}',
  forbidden_phrases TEXT[] DEFAULT '{}',
  -- State
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE brand_kits ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own brand kit" ON brand_kits
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create own brand kit" ON brand_kits
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own brand kit" ON brand_kits
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own brand kit" ON brand_kits
  FOR DELETE USING (user_id = auth.uid());

-- Index
CREATE INDEX IF NOT EXISTS idx_brand_kits_user ON brand_kits(user_id);
