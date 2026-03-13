-- =============================================
-- Migration 060: Script Templates
-- Save winning scripts as reusable templates
-- that get injected into the AI system prompt
-- =============================================

-- 0. Drop old script_templates table (had owner_id schema, no user data)
DROP TABLE IF EXISTS script_templates CASCADE;

-- 1. Create script_templates table
CREATE TABLE script_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) <= 10000),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX idx_script_templates_user_id ON script_templates(user_id);

-- 3. RLS
ALTER TABLE script_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own script templates"
  ON script_templates FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own script templates"
  ON script_templates FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own script templates"
  ON script_templates FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own script templates"
  ON script_templates FOR DELETE
  USING (user_id = auth.uid());

-- 4. Updated_at trigger
CREATE TRIGGER update_script_templates_updated_at
  BEFORE UPDATE ON script_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5. Add script_templates_max column to plan_limits
ALTER TABLE plan_limits
  ADD COLUMN IF NOT EXISTS script_templates_max INTEGER DEFAULT 3;

-- 6. Set plan-specific limits
UPDATE plan_limits SET script_templates_max = 3 WHERE plan = 'free';
UPDATE plan_limits SET script_templates_max = 5 WHERE plan = 'starter';
UPDATE plan_limits SET script_templates_max = 20 WHERE plan = 'pro';
UPDATE plan_limits SET script_templates_max = 999 WHERE plan = 'enterprise';
