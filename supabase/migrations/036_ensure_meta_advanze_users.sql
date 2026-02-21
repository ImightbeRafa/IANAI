-- =============================================
-- Migration 036: Ensure Meta AdVance plan for referral users
--
-- Ensures all listed referral emails have:
-- 1. meta_advanze plan with 'trialing' status
-- 2. 90-day trial from their signup date (or NOW if new)
-- 3. referral_signups record linked to the META-ADVANZE-2026 campaign
-- 4. Usage tracking initialized for current month
--
-- Safe to re-run: uses ON CONFLICT / DO UPDATE
-- =============================================

DO $$
DECLARE
  v_campaign_id UUID;
  v_user_id UUID;
  v_email TEXT;
  v_trial_end TIMESTAMPTZ;
  v_emails TEXT[] := ARRAY[
    'arianavaleria44@gmail.com',
    'arigonzalezarigonzalez@gmail.com',
    'santy508123@gmail.com',
    'viniciobarrantes84@gmail.com',
    'andresestebanf44@gmail.com',
    'smuhc94@gmail.com',
    'servicioalcliente@boxshippingcr.com',
    'rominasg1310@gmail.com'
  ];
BEGIN
  -- Get the Meta AdVance campaign ID
  SELECT id INTO v_campaign_id
  FROM referral_campaigns
  WHERE code = 'META-ADVANZE-2026';

  IF v_campaign_id IS NULL THEN
    RAISE EXCEPTION 'Campaign META-ADVANZE-2026 not found';
  END IF;

  FOREACH v_email IN ARRAY v_emails LOOP
    -- Find user by email in auth.users
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = v_email;

    IF v_user_id IS NULL THEN
      RAISE NOTICE 'User not found: %. Skipping.', v_email;
      CONTINUE;
    END IF;

    -- Calculate trial end: 90 days from their account creation, or 90 days from now if that's already past
    SELECT GREATEST(
      (SELECT created_at FROM auth.users WHERE id = v_user_id) + INTERVAL '90 days',
      NOW() + INTERVAL '90 days'
    ) INTO v_trial_end;

    -- Ensure profile exists
    INSERT INTO profiles (id, email, full_name, account_type)
    VALUES (
      v_user_id,
      v_email,
      split_part(v_email, '@', 1),
      'team'
    )
    ON CONFLICT (id) DO NOTHING;

    -- Set subscription to meta_advanze trialing
    INSERT INTO subscriptions (user_id, plan, status, trial_ends_at, referral_campaign_id)
    VALUES (v_user_id, 'meta_advanze', 'trialing', v_trial_end, v_campaign_id)
    ON CONFLICT (user_id) DO UPDATE SET
      plan = 'meta_advanze',
      status = 'trialing',
      trial_ends_at = v_trial_end,
      referral_campaign_id = v_campaign_id,
      updated_at = NOW();

    -- Ensure referral_signups record exists
    INSERT INTO referral_signups (campaign_id, user_id, signed_up_at, trial_ends_at)
    VALUES (v_campaign_id, v_user_id, NOW(), v_trial_end)
    ON CONFLICT (campaign_id, user_id) DO UPDATE SET
      trial_ends_at = v_trial_end;

    -- Ensure usage tracking for current month
    INSERT INTO usage (user_id, period_start, period_end)
    VALUES (
      v_user_id,
      date_trunc('month', NOW())::date,
      (date_trunc('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 day')::date
    )
    ON CONFLICT (user_id, period_start) DO NOTHING;

    -- Update campaign signup count
    UPDATE referral_campaigns
    SET current_signups = (
      SELECT COUNT(*) FROM referral_signups WHERE campaign_id = v_campaign_id
    )
    WHERE id = v_campaign_id;

    RAISE NOTICE 'OK: % → meta_advanze trial until %', v_email, v_trial_end;
  END LOOP;
END $$;
