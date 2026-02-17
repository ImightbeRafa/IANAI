-- =============================================
-- Migration 025: Enhance tracking (half-cost image edits)
-- Enhances cost 0.5 image credits (2 enhances = 1 image)
-- =============================================

-- 1. Add enhances_generated column to usage table
ALTER TABLE usage ADD COLUMN IF NOT EXISTS enhances_generated INTEGER NOT NULL DEFAULT 0;

-- 2. Update increment_usage function to support 'enhance' action
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id UUID,
  p_action TEXT  -- 'script', 'image', 'video', 'description', or 'enhance'
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
  END IF;

  -- If no row was updated, insert a new one
  IF NOT FOUND THEN
    INSERT INTO usage (user_id, period_start, period_end, scripts_generated, images_generated, videos_generated, descriptions_generated, enhances_generated)
    VALUES (
      p_user_id, v_period_start, v_period_end,
      CASE WHEN p_action = 'script' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'image' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'video' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'description' THEN 1 ELSE 0 END,
      CASE WHEN p_action = 'enhance' THEN 1 ELSE 0 END
    )
    ON CONFLICT (user_id, period_start) DO UPDATE SET
      scripts_generated = usage.scripts_generated + CASE WHEN p_action = 'script' THEN 1 ELSE 0 END,
      images_generated = usage.images_generated + CASE WHEN p_action = 'image' THEN 1 ELSE 0 END,
      videos_generated = usage.videos_generated + CASE WHEN p_action = 'video' THEN 1 ELSE 0 END,
      descriptions_generated = usage.descriptions_generated + CASE WHEN p_action = 'description' THEN 1 ELSE 0 END,
      enhances_generated = usage.enhances_generated + CASE WHEN p_action = 'enhance' THEN 1 ELSE 0 END;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
