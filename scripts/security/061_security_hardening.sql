-- =============================================
-- Migration 061: Security hardening
-- Fixes Critical/High entitlement and privilege issues found in 2026-08 security review.
-- Apply to production after review. Idempotent where practical.
-- =============================================

-- 1) Privileged billing RPCs: service_role only
REVOKE EXECUTE ON FUNCTION public.credit_bonus_images(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_bonus_image(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_usage(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_bonus_images(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_bonus_image(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_usage(uuid, text) TO service_role;

-- Harden credit_bonus_images to refuse non-service callers even if grants regress
CREATE OR REPLACE FUNCTION public.credit_bonus_images(p_user_id uuid, p_amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;
  UPDATE profiles
  SET bonus_images = COALESCE(bonus_images, 0) + p_amount
  WHERE id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_bonus_image(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT;
  v_plan_limit INT;
  v_used INT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT plan INTO v_plan FROM subscriptions WHERE user_id = p_user_id AND status IN ('active', 'trialing') LIMIT 1;
  IF v_plan IS NULL THEN v_plan := 'free'; END IF;
  SELECT images_per_month INTO v_plan_limit FROM plan_limits WHERE plan = v_plan;
  IF v_plan_limit IS NULL OR v_plan_limit = -1 THEN RETURN; END IF;
  SELECT COALESCE(images_generated, 0) INTO v_used FROM usage
  WHERE user_id = p_user_id AND period_start = date_trunc('month', CURRENT_DATE)::date;
  IF v_used IS NULL THEN v_used := 0; END IF;
  IF v_used > v_plan_limit THEN
    UPDATE profiles SET bonus_images = bonus_images - 1
    WHERE id = p_user_id AND bonus_images > 0;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_usage(p_user_id uuid, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_period_start := date_trunc('month', CURRENT_DATE)::DATE;
  v_period_end := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

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
  ELSE
    RAISE EXCEPTION 'Invalid action';
  END IF;

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
$$;

-- 2) Admin analytics RPCs must require profiles.is_admin
CREATE OR REPLACE FUNCTION public.get_usage_summary(
  start_date timestamp with time zone DEFAULT (now() - '30 days'::interval),
  end_date timestamp with time zone DEFAULT now()
)
RETURNS TABLE(
  model text, feature text, total_calls bigint, successful_calls bigint, failed_calls bigint,
  total_input_tokens bigint, total_output_tokens bigint, total_tokens bigint, total_cost_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    l.model,
    l.feature,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE l.success)::BIGINT,
    COUNT(*) FILTER (WHERE NOT l.success)::BIGINT,
    COALESCE(SUM(l.input_tokens), 0)::BIGINT,
    COALESCE(SUM(l.output_tokens), 0)::BIGINT,
    COALESCE(SUM(l.total_tokens), 0)::BIGINT,
    COALESCE(SUM(l.estimated_cost_usd), 0)::DECIMAL
  FROM api_usage_logs l
  WHERE l.created_at BETWEEN start_date AND end_date
  GROUP BY l.model, l.feature
  ORDER BY total_cost_usd DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_daily_usage(
  start_date timestamp with time zone DEFAULT (now() - '30 days'::interval),
  end_date timestamp with time zone DEFAULT now()
)
RETURNS TABLE(day date, model text, total_calls bigint, total_cost_usd numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    DATE(l.created_at) as day,
    l.model,
    COUNT(*)::BIGINT,
    COALESCE(SUM(l.estimated_cost_usd), 0)::DECIMAL
  FROM api_usage_logs l
  WHERE l.created_at BETWEEN start_date AND end_date
  GROUP BY DATE(l.created_at), l.model
  ORDER BY day DESC, l.model;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_usage_stats(
  start_date timestamp with time zone DEFAULT (now() - '30 days'::interval),
  end_date timestamp with time zone DEFAULT now()
)
RETURNS TABLE(
  user_id uuid, user_email text, total_calls bigint, total_cost_usd numeric,
  script_calls bigint, description_calls bigint, image_calls bigint, video_calls bigint,
  voice_calls bigint, other_calls bigint, last_active timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    l.user_id,
    l.user_email,
    COUNT(*)::BIGINT,
    COALESCE(SUM(l.estimated_cost_usd), 0)::DECIMAL,
    COUNT(*) FILTER (WHERE l.feature = 'script')::BIGINT,
    COUNT(*) FILTER (WHERE l.feature = 'description')::BIGINT,
    COUNT(*) FILTER (WHERE l.feature IN ('image', 'edit', 'enhance'))::BIGINT,
    COUNT(*) FILTER (WHERE l.feature IN ('video', 'kling_video'))::BIGINT,
    COUNT(*) FILTER (WHERE l.feature = 'voice_transcription')::BIGINT,
    COUNT(*) FILTER (WHERE l.feature NOT IN ('script', 'description', 'image', 'edit', 'enhance', 'video', 'kling_video', 'voice_transcription'))::BIGINT,
    MAX(l.created_at)
  FROM api_usage_logs l
  WHERE l.created_at BETWEEN start_date AND end_date
    AND l.success = true
  GROUP BY l.user_id, l.user_email
  ORDER BY total_cost_usd DESC;
END;
$$;

-- 3) Self-only usage limits + referral application
CREATE OR REPLACE FUNCTION public.get_usage_limits(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_current_month := date_trunc('month', NOW())::date;

  SELECT s.plan INTO v_plan
  FROM subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status IN ('active', 'trialing')
  LIMIT 1;

  v_plan := COALESCE(v_plan, 'free');

  SELECT pl.scripts_per_month, pl.images_per_month, pl.descriptions_per_month, pl.replies_per_month
  INTO v_scripts_limit, v_images_limit, v_descriptions_limit, v_replies_limit
  FROM plan_limits pl
  WHERE pl.plan = v_plan;

  v_scripts_limit := COALESCE(v_scripts_limit, 10);
  v_images_limit := COALESCE(v_images_limit, 1);
  v_descriptions_limit := COALESCE(v_descriptions_limit, 10);
  v_replies_limit := COALESCE(v_replies_limit, 10);

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

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_user_id uuid, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign referral_campaigns%ROWTYPE;
  v_trial_end TIMESTAMPTZ;
  v_existing_referral UUID;
  v_current_plan TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT id INTO v_existing_referral
  FROM referral_signups WHERE user_id = p_user_id;

  IF v_existing_referral IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Referral already applied');
  END IF;

  SELECT plan INTO v_current_plan
  FROM subscriptions WHERE user_id = p_user_id AND status IN ('active', 'trialing');

  IF v_current_plan IS NOT NULL AND v_current_plan NOT IN ('free') THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already has a paid plan');
  END IF;

  SELECT * INTO v_campaign
  FROM referral_campaigns
  WHERE code = UPPER(TRIM(p_code))
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (max_signups IS NULL OR current_signups < max_signups);

  IF v_campaign.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired referral code');
  END IF;

  v_trial_end := NOW() + (v_campaign.trial_days || ' days')::INTERVAL;

  UPDATE subscriptions
  SET plan = v_campaign.plan,
      status = 'trialing',
      trial_ends_at = v_trial_end,
      referral_campaign_id = v_campaign.id,
      current_period_start = NOW(),
      current_period_end = v_trial_end,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO subscriptions (user_id, plan, status, trial_ends_at, referral_campaign_id, current_period_start, current_period_end)
    VALUES (p_user_id, v_campaign.plan, 'trialing', v_trial_end, v_campaign.id, NOW(), v_trial_end);
  END IF;

  INSERT INTO referral_signups (campaign_id, user_id, trial_ends_at)
  VALUES (v_campaign.id, p_user_id, v_trial_end)
  ON CONFLICT (campaign_id, user_id) DO NOTHING;

  UPDATE referral_campaigns
  SET current_signups = current_signups + 1, updated_at = NOW()
  WHERE id = v_campaign.id;

  RETURN jsonb_build_object(
    'success', true,
    'plan', v_campaign.plan,
    'trial_ends_at', v_trial_end,
    'campaign', v_campaign.name
  );
END;
$$;

-- Prevent clients from forcing trial expiry on arbitrary users
CREATE OR REPLACE FUNCTION public.check_trial_expiry(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub RECORD;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_sub
  FROM subscriptions
  WHERE user_id = p_user_id AND status = 'trialing';

  IF v_sub IS NULL THEN
    RETURN 'no_trial';
  END IF;

  IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at < NOW() THEN
    UPDATE subscriptions
    SET plan = 'free', status = 'active', trial_ends_at = NULL, updated_at = NOW()
    WHERE id = v_sub.id;
    RETURN 'expired';
  END IF;

  RETURN 'active';
END;
$$;

-- 4) Protect privileged profile columns (admin + bonus credits)
CREATE OR REPLACE FUNCTION public.protect_admin_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'authenticated' OR (SELECT auth.role()) = 'authenticated' THEN
    NEW.is_admin := OLD.is_admin;
    NEW.bonus_images := OLD.bonus_images;
    NEW.role := OLD.role;
    NEW.account_type := OLD.account_type;
  END IF;
  RETURN NEW;
END;
$$;

-- 5) Subscriptions / usage: clients may read, not write entitlement rows
DROP POLICY IF EXISTS "Users can manage own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "System can manage usage" ON public.usage;

-- Keep read policies; ensure write path is service_role only
DROP POLICY IF EXISTS "Service role full access subscriptions" ON public.subscriptions;
CREATE POLICY "Service role full access subscriptions"
  ON public.subscriptions
  FOR ALL
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access usage" ON public.usage;
CREATE POLICY "Service role full access usage"
  ON public.usage
  FOR ALL
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 6) Profiles: stop global email dump to every authenticated user
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;

-- 7) api_usage_logs: only service_role may insert
DROP POLICY IF EXISTS "Service role can insert logs" ON public.api_usage_logs;
CREATE POLICY "Service role can insert logs"
  ON public.api_usage_logs
  FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

-- 8) Storage uploads must stay under the caller's uid folder
DROP POLICY IF EXISTS "Users can upload post images" ON storage.objects;
CREATE POLICY "Users can upload post images"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'post-images'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can upload feedback screenshots" ON storage.objects;
CREATE POLICY "Users can upload feedback screenshots"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-screenshots'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );
