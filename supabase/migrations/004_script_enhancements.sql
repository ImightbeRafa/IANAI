-- Migration: Script Enhancement Features
-- Date: February 3, 2026
-- Purpose: Add frameworks, tones, lengths, ratings, and versioning for scripts

-- =============================================
-- 0. CREATE HELPER FUNCTION (if not exists)
-- =============================================
CREATE OR REPLACE FUNCTION get_user_team_ids(user_uuid UUID)
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT team_id FROM team_members WHERE user_id = user_uuid;
$$;

-- =============================================
-- 1. ADD SCRIPT GENERATION SETTINGS TO CHAT_SESSIONS
-- =============================================
-- These settings are per-session so users can experiment with different approaches

ALTER TABLE chat_sessions 
ADD COLUMN IF NOT EXISTS framework TEXT DEFAULT 'direct' 
  CHECK (framework IN ('direct', 'pas', 'aida', 'bab', 'fourp')),
ADD COLUMN IF NOT EXISTS tone TEXT DEFAULT 'professional'
  CHECK (tone IN ('professional', 'casual', 'urgent', 'humorous', 'inspirational', 'controversial')),
ADD COLUMN IF NOT EXISTS duration TEXT DEFAULT '30s'
  CHECK (duration IN ('15s', '30s', '60s', '90s')),
ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'general'
  CHECK (platform IN ('general', 'tiktok', 'instagram', 'youtube', 'facebook', 'linkedin', 'tv', 'radio'));

-- =============================================
-- 2. ADD RATING AND VERSIONING TO SCRIPTS
-- =============================================

ALTER TABLE scripts
ADD COLUMN IF NOT EXISTS rating INTEGER DEFAULT NULL CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS parent_script_id UUID REFERENCES scripts(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS framework TEXT,
ADD COLUMN IF NOT EXISTS tone TEXT,
ADD COLUMN IF NOT EXISTS duration TEXT,
ADD COLUMN IF NOT EXISTS platform TEXT,
ADD COLUMN IF NOT EXISTS variation_number INTEGER DEFAULT 1;

-- =============================================
-- 3. CREATE SCRIPT_TEMPLATES TABLE (for saving favorite scripts as templates)
-- =============================================

CREATE TABLE IF NOT EXISTS script_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  framework TEXT,
  tone TEXT,
  duration TEXT,
  platform TEXT,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT template_ownership CHECK (owner_id IS NOT NULL OR team_id IS NOT NULL)
);

-- Enable RLS
ALTER TABLE script_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for script_templates
CREATE POLICY "Users can view own templates" ON script_templates
  FOR SELECT USING (
    owner_id = auth.uid() OR 
    team_id IN (SELECT get_user_team_ids(auth.uid()))
  );

CREATE POLICY "Users can create templates" ON script_templates
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update own templates" ON script_templates
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Users can delete own templates" ON script_templates
  FOR DELETE USING (owner_id = auth.uid());

-- =============================================
-- 4. CREATE INDEX FOR FASTER QUERIES
-- =============================================

CREATE INDEX IF NOT EXISTS idx_scripts_rating ON scripts(rating) WHERE rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scripts_parent ON scripts(parent_script_id) WHERE parent_script_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_script_templates_owner ON script_templates(owner_id);
CREATE INDEX IF NOT EXISTS idx_script_templates_team ON script_templates(team_id);

-- =============================================
-- 5. UPDATE TRIGGER FOR script_templates
-- =============================================

CREATE TRIGGER update_script_templates_updated_at
  BEFORE UPDATE ON script_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
