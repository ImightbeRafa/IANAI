-- =============================================
-- Migration 056: Set iankuper506@gmail.com to enterprise plan
-- Safe to re-run: uses ON CONFLICT / DO UPDATE
-- =============================================

DO $$
DECLARE
  v_user_id UUID;
  v_email TEXT := 'iankuper506@gmail.com';
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_email);

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'User not found: %. Skipping.', v_email;
    RETURN;
  END IF;

  -- Ensure profile exists
  INSERT INTO profiles (id, email, full_name, account_type)
  VALUES (v_user_id, v_email, split_part(v_email, '@', 1), 'team')
  ON CONFLICT (id) DO NOTHING;

  -- Set subscription to enterprise active
  INSERT INTO subscriptions (user_id, plan, status)
  VALUES (v_user_id, 'enterprise', 'active')
  ON CONFLICT (user_id) DO UPDATE SET
    plan = 'enterprise',
    status = 'active',
    updated_at = NOW();

  -- Ensure usage tracking for current month
  INSERT INTO usage (user_id, period_start, period_end)
  VALUES (
    v_user_id,
    date_trunc('month', NOW())::date,
    (date_trunc('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 day')::date
  )
  ON CONFLICT (user_id, period_start) DO NOTHING;

  RAISE NOTICE 'OK: % → enterprise (active)', v_email;
END $$;
