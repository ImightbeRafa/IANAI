-- =============================================
-- Migration 041: get_usage_limits RPC
-- Consolidates 4 separate queries into 1 DB call
-- for faster page loads
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
  v_scripts_used INT := 0;
  v_images_used INT := 0;
  v_descriptions_used INT := 0;
  v_enhances_used INT := 0;
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
  SELECT pl.scripts_per_month, pl.images_per_month, pl.descriptions_per_month
  INTO v_scripts_limit, v_images_limit, v_descriptions_limit
  FROM plan_limits pl
  WHERE pl.plan = v_plan;

  v_scripts_limit := COALESCE(v_scripts_limit, 10);
  v_images_limit := COALESCE(v_images_limit, 1);
  v_descriptions_limit := COALESCE(v_descriptions_limit, 10);

  -- 3) Get current month usage
  SELECT u.scripts_generated, u.images_generated, u.descriptions_generated, u.enhances_generated
  INTO v_scripts_used, v_images_used, v_descriptions_used, v_enhances_used
  FROM usage u
  WHERE u.user_id = p_user_id
    AND u.period_start = v_current_month;

  v_scripts_used := COALESCE(v_scripts_used, 0);
  v_images_used := COALESCE(v_images_used, 0);
  v_descriptions_used := COALESCE(v_descriptions_used, 0);
  v_enhances_used := COALESCE(v_enhances_used, 0);

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
    'descriptionsLimit', v_descriptions_limit
  );
END;
$$;
