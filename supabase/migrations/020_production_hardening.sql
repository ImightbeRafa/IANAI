-- =============================================
-- Migration 020: Production Hardening
-- - RLS on api_usage_logs (admin-only read)
-- - Atomic usage increment function
-- - Product type constraint update
-- =============================================

-- 1. RLS on api_usage_logs — only admins can read
ALTER TABLE IF EXISTS api_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view usage logs" ON api_usage_logs;
CREATE POLICY "Admins can view usage logs" ON api_usage_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Service role can insert (API routes use service_role key)
DROP POLICY IF EXISTS "Service role can insert logs" ON api_usage_logs;
CREATE POLICY "Service role can insert logs" ON api_usage_logs
  FOR INSERT WITH CHECK (true);

-- 2. Atomic usage increment function (prevents race conditions)
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id UUID,
  p_action TEXT  -- 'script', 'image', or 'video'
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
  END IF;

  -- If no row was updated, insert a new one
  IF NOT FOUND THEN
    INSERT INTO usage (user_id, period_start, period_end, scripts_generated, images_generated, videos_generated)
    VALUES (
      p_user_id, v_period_start, v_period_end,
      CASE WHEN p_action = 'script' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'image' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'video' THEN 1 ELSE 0 END
    )
    ON CONFLICT (user_id, period_start) DO UPDATE SET
      scripts_generated = usage.scripts_generated + CASE WHEN p_action = 'script' THEN 1 ELSE 0 END,
      images_generated = usage.images_generated + CASE WHEN p_action = 'image' THEN 1 ELSE 0 END,
      videos_generated = usage.videos_generated + CASE WHEN p_action = 'video' THEN 1 ELSE 0 END;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update product type constraint to include restaurant and real_estate
-- (Only run if constraint exists with old values)
DO $$
BEGIN
  -- Drop old constraint if it only allows 'product' and 'service'
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'products_type_check'
  ) THEN
    ALTER TABLE products DROP CONSTRAINT products_type_check;
    ALTER TABLE products ADD CONSTRAINT products_type_check
      CHECK (type IN ('product', 'service', 'restaurant', 'real_estate'));
  END IF;
END $$;
