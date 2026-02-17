-- Migration 024: Add bonus_images pool to profiles
-- This is a persistent pool that does NOT reset monthly.
-- When a premium user buys a 100-image boost ($14.99 one-time),
-- bonus_images increments by 100. When they exceed their plan limit,
-- bonus_images is decremented instead.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bonus_images INT DEFAULT 0;

-- Atomic decrement: deduct 1 bonus image only when user is in bonus territory
CREATE OR REPLACE FUNCTION deduct_bonus_image(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
  v_plan TEXT;
  v_plan_limit INT;
  v_used INT;
BEGIN
  -- Get user's plan
  SELECT plan INTO v_plan FROM subscriptions WHERE user_id = p_user_id AND status = 'active' LIMIT 1;
  IF v_plan IS NULL THEN v_plan := 'free'; END IF;

  -- Get base plan limit for images
  SELECT images_per_month INTO v_plan_limit FROM plan_limits WHERE plan = v_plan;
  IF v_plan_limit IS NULL OR v_plan_limit = -1 THEN RETURN; END IF;

  -- Get current month usage
  SELECT COALESCE(images_generated, 0) INTO v_used FROM usage
  WHERE user_id = p_user_id AND period_start = date_trunc('month', CURRENT_DATE)::date;
  IF v_used IS NULL THEN v_used := 0; END IF;

  -- Only deduct if user exceeded base plan limit (i.e. consuming from bonus pool)
  IF v_used > v_plan_limit THEN
    UPDATE profiles SET bonus_images = bonus_images - 1
    WHERE id = p_user_id AND bonus_images > 0;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Credit bonus images (used by webhook after purchase)
CREATE OR REPLACE FUNCTION credit_bonus_images(p_user_id UUID, p_amount INT)
RETURNS VOID AS $$
BEGIN
  UPDATE profiles
  SET bonus_images = COALESCE(bonus_images, 0) + p_amount
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
