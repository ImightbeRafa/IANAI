-- =============================================
-- Migration 049: Respuestas — Client Message Response Generator
-- Tables: reply_sessions, reply_messages, reply_context_sources
-- Usage: replies_per_month in plan_limits, replies_generated in usage
-- =============================================

-- =============================================
-- 1. REPLY SESSIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS reply_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_sessions_product_user ON reply_sessions(product_id, user_id);

-- RLS
ALTER TABLE reply_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own reply sessions" ON reply_sessions;
CREATE POLICY "Users can view own reply sessions"
  ON reply_sessions FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own reply sessions" ON reply_sessions;
CREATE POLICY "Users can insert own reply sessions"
  ON reply_sessions FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own reply sessions" ON reply_sessions;
CREATE POLICY "Users can update own reply sessions"
  ON reply_sessions FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own reply sessions" ON reply_sessions;
CREATE POLICY "Users can delete own reply sessions"
  ON reply_sessions FOR DELETE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage reply sessions" ON reply_sessions;
CREATE POLICY "Service role can manage reply sessions"
  ON reply_sessions FOR ALL TO service_role USING (true);

-- =============================================
-- 2. REPLY MESSAGES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS reply_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES reply_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_messages_session ON reply_messages(session_id);

-- RLS (join through reply_sessions for ownership check)
ALTER TABLE reply_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own reply messages" ON reply_messages;
CREATE POLICY "Users can view own reply messages"
  ON reply_messages FOR SELECT USING (
    EXISTS (SELECT 1 FROM reply_sessions rs WHERE rs.id = session_id AND rs.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can insert own reply messages" ON reply_messages;
CREATE POLICY "Users can insert own reply messages"
  ON reply_messages FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM reply_sessions rs WHERE rs.id = session_id AND rs.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete own reply messages" ON reply_messages;
CREATE POLICY "Users can delete own reply messages"
  ON reply_messages FOR DELETE USING (
    EXISTS (SELECT 1 FROM reply_sessions rs WHERE rs.id = session_id AND rs.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Service role can manage reply messages" ON reply_messages;
CREATE POLICY "Service role can manage reply messages"
  ON reply_messages FOR ALL TO service_role USING (true);

-- =============================================
-- 3. REPLY CONTEXT SOURCES TABLE (persistent knowledge base per product)
-- =============================================
CREATE TABLE IF NOT EXISTS reply_context_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('url', 'text', 'image')),
  title TEXT NOT NULL,
  content TEXT,
  url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_context_sources_product_user ON reply_context_sources(product_id, user_id);

-- RLS
ALTER TABLE reply_context_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own reply context sources" ON reply_context_sources;
CREATE POLICY "Users can view own reply context sources"
  ON reply_context_sources FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own reply context sources" ON reply_context_sources;
CREATE POLICY "Users can insert own reply context sources"
  ON reply_context_sources FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own reply context sources" ON reply_context_sources;
CREATE POLICY "Users can delete own reply context sources"
  ON reply_context_sources FOR DELETE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage reply context sources" ON reply_context_sources;
CREATE POLICY "Service role can manage reply context sources"
  ON reply_context_sources FOR ALL TO service_role USING (true);

-- =============================================
-- 4. USAGE TRACKING — replies_per_month + replies_generated
-- =============================================

-- Add replies_per_month to plan_limits
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS replies_per_month INTEGER NOT NULL DEFAULT 10;

-- Add replies_generated to usage
ALTER TABLE usage ADD COLUMN IF NOT EXISTS replies_generated INTEGER NOT NULL DEFAULT 0;

-- Update plan limits
UPDATE plan_limits SET replies_per_month = 10 WHERE plan = 'free';
UPDATE plan_limits SET replies_per_month = 30 WHERE plan = 'starter';
UPDATE plan_limits SET replies_per_month = -1 WHERE plan = 'pro';
UPDATE plan_limits SET replies_per_month = -1 WHERE plan = 'enterprise';

-- =============================================
-- 5. UPDATE increment_usage FUNCTION — add 'reply' branch
-- =============================================
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id UUID,
  p_action TEXT  -- 'script', 'image', 'video', 'description', 'enhance', or 'reply'
) RETURNS VOID AS $$
DECLARE
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  v_period_start := date_trunc('month', CURRENT_DATE)::DATE;
  v_period_end := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Try to update existing record atomically
  IF p_action = 'script' THEN
    UPDATE usage SET scripts_generated = scripts_generated + 1
    WHERE user_id = p_user_id AND period_start = v_period_start;
  ELSIF p_action = 'image' THEN
    UPDATE usage SET images_generated = images_generated + 1
    WHERE user_id = p_user_id AND period_start = v_period_start;
  ELSIF p_action = 'video' THEN
    UPDATE usage SET videos_generated = videos_generated + 1
    WHERE user_id = p_user_id AND period_start = v_period_start;
  ELSIF p_action = 'description' THEN
    UPDATE usage SET descriptions_generated = descriptions_generated + 1
    WHERE user_id = p_user_id AND period_start = v_period_start;
  ELSIF p_action = 'enhance' THEN
    UPDATE usage SET enhances_generated = enhances_generated + 1
    WHERE user_id = p_user_id AND period_start = v_period_start;
  ELSIF p_action = 'reply' THEN
    UPDATE usage SET replies_generated = replies_generated + 1
    WHERE user_id = p_user_id AND period_start = v_period_start;
  END IF;

  -- If no row was updated, insert a new one
  IF NOT FOUND THEN
    INSERT INTO usage (user_id, period_start, period_end, scripts_generated, images_generated, videos_generated, descriptions_generated, enhances_generated, replies_generated)
    VALUES (
      p_user_id, v_period_start, v_period_end,
      CASE WHEN p_action = 'script' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'image' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'video' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'description' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'enhance' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'reply' THEN 1 ELSE 0 END
    )
    ON CONFLICT (user_id, period_start) DO UPDATE SET
      scripts_generated = usage.scripts_generated + CASE WHEN p_action = 'script' THEN 1 ELSE 0 END,
      images_generated = usage.images_generated + CASE WHEN p_action = 'image' THEN 1 ELSE 0 END,
      videos_generated = usage.videos_generated + CASE WHEN p_action = 'video' THEN 1 ELSE 0 END,
      descriptions_generated = usage.descriptions_generated + CASE WHEN p_action = 'description' THEN 1 ELSE 0 END,
      enhances_generated = usage.enhances_generated + CASE WHEN p_action = 'enhance' THEN 1 ELSE 0 END,
      replies_generated = usage.replies_generated + CASE WHEN p_action = 'reply' THEN 1 ELSE 0 END;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 6. UPDATE get_usage_limits RPC — add replies
-- =============================================
CREATE OR REPLACE FUNCTION get_usage_limits(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plan TEXT := 'free';
  v_scripts_limit INT := 10;
  v_images_limit INT := 1;
  v_descriptions_limit INT := 10;
  v_replies_limit INT := 10;
  v_scripts_used INT := 0;
  v_images_used INT := 0;
  v_descriptions_used INT := 0;
  v_enhances_used INT := 0;
  v_replies_used INT := 0;
  v_bonus_images INT := 0;
  v_current_month DATE;
BEGIN
  -- Current month period start
  v_current_month := date_trunc('month', NOW())::date;

  -- 1) Get active subscription plan
  SELECT s.plan INTO v_plan
  FROM subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status IN ('active', 'trialing')
  LIMIT 1;

  v_plan := COALESCE(v_plan, 'free');

  -- 2) Get plan limits
  SELECT pl.scripts_per_month, pl.images_per_month, pl.descriptions_per_month, pl.replies_per_month
  INTO v_scripts_limit, v_images_limit, v_descriptions_limit, v_replies_limit
  FROM plan_limits pl
  WHERE pl.plan = v_plan;

  v_scripts_limit := COALESCE(v_scripts_limit, 10);
  v_images_limit := COALESCE(v_images_limit, 1);
  v_descriptions_limit := COALESCE(v_descriptions_limit, 10);
  v_replies_limit := COALESCE(v_replies_limit, 10);

  -- 3) Get current month usage
  SELECT u.scripts_generated, u.images_generated, u.descriptions_generated, u.enhances_generated, u.replies_generated
  INTO v_scripts_used, v_images_used, v_descriptions_used, v_enhances_used, v_replies_used
  FROM usage u
  WHERE u.user_id = p_user_id
    AND u.period_start = v_current_month;

  v_scripts_used := COALESCE(v_scripts_used, 0);
  v_images_used := COALESCE(v_images_used, 0);
  v_descriptions_used := COALESCE(v_descriptions_used, 0);
  v_enhances_used := COALESCE(v_enhances_used, 0);
  v_replies_used := COALESCE(v_replies_used, 0);

  -- 4) Get bonus images
  SELECT p.bonus_images INTO v_bonus_images
  FROM profiles p
  WHERE p.id = p_user_id;

  v_bonus_images := COALESCE(v_bonus_images, 0);

  RETURN json_build_object(
    'plan', v_plan,
    'scriptsUsed', v_scripts_used,
    'scriptsLimit', v_scripts_limit,
    'imagesUsed', v_images_used + (v_enhances_used / 2),
    'imagesLimit', CASE WHEN v_images_limit = -1 THEN -1 ELSE v_images_limit + v_bonus_images END,
    'bonusImages', v_bonus_images,
    'descriptionsUsed', v_descriptions_used,
    'descriptionsLimit', v_descriptions_limit,
    'repliesUsed', v_replies_used,
    'repliesLimit', v_replies_limit
  );
END;
$$;

-- =============================================
-- 7. UPDATED_AT TRIGGER for reply_sessions
-- =============================================
DROP TRIGGER IF EXISTS update_reply_sessions_updated_at ON reply_sessions;
CREATE TRIGGER update_reply_sessions_updated_at
  BEFORE UPDATE ON reply_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
