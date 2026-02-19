-- ============================================================
-- 034: Fix Meta AdVance signup failure
--
-- Root cause: The CHECK constraint on subscriptions.plan was
-- auto-named by PostgreSQL (not 'subscriptions_plan_check'),
-- so migration 032's DROP CONSTRAINT didn't find it.
-- The old constraint blocks plan='meta_advanze'.
--
-- This migration:
-- 1. Finds and drops ALL check constraints on subscriptions.plan
-- 2. Adds the correct constraint allowing 'meta_advanze'
-- 3. Same for plan_limits
-- 4. Re-creates handle_new_user_subscription() with robust error handling
-- 5. Wraps handle_new_user() profile INSERT in exception block
-- ============================================================

-- ============================================================
-- STEP 1: Drop ALL check constraints on subscriptions.plan
-- Uses dynamic SQL to find the actual constraint names
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop all CHECK constraints on subscriptions that reference 'plan'
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'subscriptions'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'  -- check constraint
      AND pg_get_constraintdef(con.oid) LIKE '%plan%'
  LOOP
    EXECUTE format('ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS %I', r.conname);
    RAISE NOTICE 'Dropped constraint: %', r.conname;
  END LOOP;

  -- Drop all CHECK constraints on plan_limits that reference 'plan'
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'plan_limits'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%plan%'
  LOOP
    EXECUTE format('ALTER TABLE public.plan_limits DROP CONSTRAINT IF EXISTS %I', r.conname);
    RAISE NOTICE 'Dropped constraint: %', r.conname;
  END LOOP;
END;
$$;

-- ============================================================
-- STEP 2: Add correct CHECK constraints
-- ============================================================
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('free', 'starter', 'pro', 'enterprise', 'meta_advanze'));

ALTER TABLE public.plan_limits ADD CONSTRAINT plan_limits_plan_check
  CHECK (plan IN ('free', 'starter', 'pro', 'enterprise', 'meta_advanze'));

-- ============================================================
-- STEP 3: Ensure trial columns exist on subscriptions
-- ============================================================
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS referral_campaign_id UUID;

-- ============================================================
-- STEP 4: Ensure meta_advanze plan exists in plan_limits
-- ============================================================
INSERT INTO plan_limits (plan, scripts_per_month, images_per_month, max_team_members, max_clients, max_products, price_monthly, price_yearly, features, descriptions_per_month)
VALUES (
  'meta_advanze',
  -1, 100, 10, -1, -1, 2400, 24000,
  '["basic_scripts", "images", "icp_profiles", "priority_support", "meta_advanze_partner"]',
  -1
)
ON CONFLICT (plan) DO NOTHING;

-- ============================================================
-- STEP 5: Re-create handle_new_user() with full exception handling
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_team_id UUID;
  v_full_name TEXT;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  -- Create profile (most critical step)
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, account_type)
    VALUES (NEW.id, NEW.email, v_full_name, 'team')
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile creation failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
  END;

  -- Create team (secondary)
  BEGIN
    INSERT INTO public.teams (name, owner_id)
    VALUES (v_full_name || '''s Team', NEW.id)
    RETURNING id INTO new_team_id;

    INSERT INTO public.team_members (team_id, user_id, role, joined_at)
    VALUES (new_team_id, NEW.id, 'owner', NOW())
    ON CONFLICT (team_id, user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: team creation failed for user %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- STEP 6: Re-create handle_new_user_subscription() with referral support
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS TRIGGER AS $$
DECLARE
  v_referral_code TEXT;
  v_campaign RECORD;
  v_trial_end TIMESTAMPTZ;
BEGIN
  -- Check if user signed up with a referral code (email signup passes it in metadata)
  BEGIN
    SELECT raw_user_meta_data->>'referral_code' INTO v_referral_code
    FROM auth.users WHERE id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    v_referral_code := NULL;
  END;

  IF v_referral_code IS NOT NULL AND v_referral_code != '' THEN
    -- Validate the referral campaign
    SELECT * INTO v_campaign
    FROM referral_campaigns
    WHERE code = UPPER(TRIM(v_referral_code))
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (max_signups IS NULL OR current_signups < max_signups);

    IF v_campaign IS NOT NULL AND v_campaign.id IS NOT NULL THEN
      -- Valid campaign — create trial subscription
      v_trial_end := NOW() + (v_campaign.trial_days || ' days')::INTERVAL;

      INSERT INTO public.subscriptions (user_id, plan, status, trial_ends_at, referral_campaign_id, current_period_start, current_period_end)
      VALUES (NEW.id, v_campaign.plan, 'trialing', v_trial_end, v_campaign.id, NOW(), v_trial_end)
      ON CONFLICT (user_id) DO UPDATE SET
        plan = EXCLUDED.plan,
        status = EXCLUDED.status,
        trial_ends_at = EXCLUDED.trial_ends_at,
        referral_campaign_id = EXCLUDED.referral_campaign_id,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        updated_at = NOW();

      -- Log referral signup
      BEGIN
        INSERT INTO referral_signups (campaign_id, user_id, trial_ends_at)
        VALUES (v_campaign.id, NEW.id, v_trial_end)
        ON CONFLICT (campaign_id, user_id) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_new_user_subscription: referral_signups insert failed: %', SQLERRM;
      END;

      -- Increment campaign counter
      UPDATE referral_campaigns SET current_signups = current_signups + 1, updated_at = NOW()
      WHERE id = v_campaign.id;

      -- Initialize usage tracking
      INSERT INTO public.usage (user_id, period_start, period_end)
      VALUES (NEW.id, date_trunc('month', NOW())::date, (date_trunc('month', NOW()) + interval '1 month' - interval '1 day')::date)
      ON CONFLICT (user_id, period_start) DO NOTHING;

      RETURN NEW;
    END IF;
  END IF;

  -- No valid referral — default free subscription
  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.usage (user_id, period_start, period_end)
  VALUES (NEW.id, date_trunc('month', NOW())::date, (date_trunc('month', NOW()) + interval '1 month' - interval '1 day')::date)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Last resort: ensure signup never fails due to subscription logic
  RAISE WARNING 'handle_new_user_subscription: failed for user %: %', NEW.id, SQLERRM;
  -- Try to at least create a free subscription
  BEGIN
    INSERT INTO public.subscriptions (user_id, plan, status)
    VALUES (NEW.id, 'free', 'active')
    ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO public.usage (user_id, period_start, period_end)
    VALUES (NEW.id, date_trunc('month', NOW())::date, (date_trunc('month', NOW()) + interval '1 month' - interval '1 day')::date)
    ON CONFLICT (user_id, period_start) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user_subscription: even free fallback failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_profile_created_subscription ON profiles;
CREATE TRIGGER on_profile_created_subscription
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();

-- ============================================================
-- STEP 7: Verify setup (will show NOTICE messages)
-- ============================================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Check subscriptions CHECK constraint
  SELECT COUNT(*) INTO v_count
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'subscriptions' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%meta_advanze%';
  IF v_count > 0 THEN
    RAISE NOTICE '✓ subscriptions CHECK constraint includes meta_advanze';
  ELSE
    RAISE WARNING '✗ subscriptions CHECK constraint does NOT include meta_advanze!';
  END IF;

  -- Check plan_limits has meta_advanze
  SELECT COUNT(*) INTO v_count FROM plan_limits WHERE plan = 'meta_advanze';
  IF v_count > 0 THEN
    RAISE NOTICE '✓ plan_limits has meta_advanze row';
  ELSE
    RAISE WARNING '✗ plan_limits missing meta_advanze row!';
  END IF;

  -- Check referral_campaigns has the campaign
  SELECT COUNT(*) INTO v_count FROM referral_campaigns WHERE code = 'META-ADVANZE-2026' AND is_active = TRUE;
  IF v_count > 0 THEN
    RAISE NOTICE '✓ META-ADVANZE-2026 campaign is active';
  ELSE
    RAISE WARNING '✗ META-ADVANZE-2026 campaign not found or inactive!';
  END IF;

  -- Check trial columns exist
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_name = 'subscriptions' AND column_name = 'trial_ends_at';
  IF v_count > 0 THEN
    RAISE NOTICE '✓ subscriptions.trial_ends_at column exists';
  ELSE
    RAISE WARNING '✗ subscriptions.trial_ends_at column missing!';
  END IF;
END;
$$;
