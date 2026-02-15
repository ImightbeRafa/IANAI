-- =============================================
-- Migration 022: New plan structure
-- Free ($0): 10 scripts, 10 descriptions, 1 image
-- Starter ($33): 30 scripts, unlimited descriptions, 5 images
-- Premium (pro) ($49): unlimited scripts, unlimited descriptions, ICP, 100 images
-- Enterprise ($299): unlimited everything + AI customization
-- =============================================

-- 1. Add descriptions_per_month to plan_limits
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS descriptions_per_month INTEGER NOT NULL DEFAULT -1;

-- 2. Add descriptions_generated to usage
ALTER TABLE usage ADD COLUMN IF NOT EXISTS descriptions_generated INTEGER NOT NULL DEFAULT 0;

-- 3. Update plan limits to match new pricing
UPDATE plan_limits SET
  scripts_per_month = 10,
  images_per_month = 1,
  descriptions_per_month = 10,
  price_monthly = 0,
  price_yearly = 0
WHERE plan = 'free';

UPDATE plan_limits SET
  scripts_per_month = 30,
  images_per_month = 5,
  descriptions_per_month = -1,
  price_monthly = 3300,
  price_yearly = 33000
WHERE plan = 'starter';

UPDATE plan_limits SET
  scripts_per_month = -1,
  images_per_month = 100,
  descriptions_per_month = -1,
  price_monthly = 4900,
  price_yearly = 49000
WHERE plan = 'pro';

UPDATE plan_limits SET
  scripts_per_month = -1,
  images_per_month = -1,
  descriptions_per_month = -1,
  price_monthly = 29900,
  price_yearly = 299000
WHERE plan = 'enterprise';

-- 4. Update increment_usage function to support 'description' action
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id UUID,
  p_action TEXT  -- 'script', 'image', 'video', or 'description'
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
  END IF;

  -- If no row was updated, insert a new one
  IF NOT FOUND THEN
    INSERT INTO usage (user_id, period_start, period_end, scripts_generated, images_generated, videos_generated, descriptions_generated)
    VALUES (
      p_user_id, v_period_start, v_period_end,
      CASE WHEN p_action = 'script' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'image' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'video' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'description' THEN 1 ELSE 0 END
    )
    ON CONFLICT (user_id, period_start) DO UPDATE SET
      scripts_generated = usage.scripts_generated + CASE WHEN p_action = 'script' THEN 1 ELSE 0 END,
      images_generated = usage.images_generated + CASE WHEN p_action = 'image' THEN 1 ELSE 0 END,
      videos_generated = usage.videos_generated + CASE WHEN p_action = 'video' THEN 1 ELSE 0 END,
      descriptions_generated = usage.descriptions_generated + CASE WHEN p_action = 'description' THEN 1 ELSE 0 END;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Ensure special admin emails have enterprise plan
-- (handles both email variants for ian)
UPDATE profiles SET is_admin = TRUE
WHERE email IN (
  'ralauas@gmail.com',
  'admin@advanceai.studio',
  'ian@iankupfer.com',
  'ian@iankuper.com',
  'deepsleepp.cr@gmail.com'
);

INSERT INTO subscriptions (user_id, plan, status)
SELECT p.id, 'enterprise', 'active'
FROM profiles p
WHERE p.email IN (
  'ralauas@gmail.com',
  'admin@advanceai.studio',
  'ian@iankupfer.com',
  'ian@iankuper.com',
  'deepsleepp.cr@gmail.com'
)
ON CONFLICT (user_id) DO UPDATE SET
  plan = 'enterprise',
  status = 'active';

-- Verify
SELECT plan, scripts_per_month, descriptions_per_month, images_per_month, price_monthly FROM plan_limits ORDER BY price_monthly NULLS LAST;
