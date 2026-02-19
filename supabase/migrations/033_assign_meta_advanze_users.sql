-- ============================================================
-- 033: Assign existing users to Meta Advanze plan (3-month trial)
-- Run AFTER migration 032_meta_advanze_referral.sql
-- ============================================================

DO $$
DECLARE
  v_campaign_id UUID;
  v_user RECORD;
  v_emails TEXT[] := ARRAY[
    'arianavaleria44@gmail.com',
    'arigonzalezarigonzalez@gmail.com',
    'santy508123@gmail.com',
    'viniciobarrantes84@gmail.com',
    'andresestebanf44@gmail.com'
  ];
BEGIN
  -- Get the META-ADVANZE-2026 campaign ID
  SELECT id INTO v_campaign_id
  FROM public.referral_campaigns
  WHERE code = 'META-ADVANZE-2026';

  IF v_campaign_id IS NULL THEN
    RAISE EXCEPTION 'Campaign META-ADVANZE-2026 not found. Run migration 032 first.';
  END IF;

  -- Loop through each email
  FOR v_user IN
    SELECT p.id AS user_id, p.email
    FROM public.profiles p
    WHERE p.email = ANY(v_emails)
  LOOP
    -- Update subscription to meta_advanze with 3-month trial
    UPDATE public.subscriptions
    SET plan = 'meta_advanze',
        status = 'trialing',
        trial_ends_at = NOW() + INTERVAL '3 months',
        referral_campaign_id = v_campaign_id,
        updated_at = NOW()
    WHERE user_id = v_user.user_id;

    -- Log in referral_signups for audit trail
    INSERT INTO public.referral_signups (campaign_id, user_id, trial_ends_at)
    VALUES (v_campaign_id, v_user.user_id, NOW() + INTERVAL '3 months')
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Assigned meta_advanze trial to: %', v_user.email;
  END LOOP;

  -- Report any emails not found
  FOR v_user IN
    SELECT unnest(v_emails) AS email
    EXCEPT
    SELECT email FROM public.profiles WHERE email = ANY(v_emails)
  LOOP
    RAISE WARNING 'User NOT found in profiles: %', v_user.email;
  END LOOP;
END;
$$;
