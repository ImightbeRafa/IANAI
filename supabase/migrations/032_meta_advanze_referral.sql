-- =============================================
-- Migration 032: Meta AdVance Referral Plan
--
-- Creates a referral system for partner campaigns.
-- First campaign: "Meta AdVance" — 3 months free premium,
-- then $24/mo for the meta_advanze plan.
--
-- Security:
-- - Server-side code validation in DB trigger
-- - Campaign active/inactive toggle + expiry date
-- - Max signups cap per campaign
-- - One referral per user (UNIQUE constraint)
-- - Audit trail in referral_signups table
-- =============================================

-- =============================================
-- STEP 1: Expand plan CHECK constraints to include 'meta_advanze'
-- =============================================

-- subscriptions table
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('free', 'starter', 'pro', 'enterprise', 'meta_advanze'));

-- plan_limits table
ALTER TABLE plan_limits DROP CONSTRAINT IF EXISTS plan_limits_plan_check;
ALTER TABLE plan_limits ADD CONSTRAINT plan_limits_plan_check
  CHECK (plan IN ('free', 'starter', 'pro', 'enterprise', 'meta_advanze'));

-- pending_subscriptions table (if exists)
ALTER TABLE pending_subscriptions DROP CONSTRAINT IF EXISTS pending_subscriptions_plan_check;
ALTER TABLE pending_subscriptions ADD CONSTRAINT pending_subscriptions_plan_check
  CHECK (plan IN ('starter', 'pro', 'meta_advanze'));

-- =============================================
-- STEP 2: Add trial columns to subscriptions
-- =============================================
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS referral_campaign_id UUID;

-- =============================================
-- STEP 3: Insert meta_advanze plan limits (same as pro, $24/mo)
-- =============================================
INSERT INTO plan_limits (plan, scripts_per_month, images_per_month, max_team_members, max_clients, max_products, price_monthly, price_yearly, features, descriptions_per_month)
VALUES (
  'meta_advanze',
  -1,    -- unlimited scripts (same as pro)
  100,   -- 100 images (same as pro)
  10,    -- same as pro
  -1,    -- unlimited clients
  -1,    -- unlimited products
  2400,  -- $24/mo (in cents)
  24000, -- $240/year (in cents)
  '["basic_scripts", "images", "icp_profiles", "priority_support", "meta_advanze_partner"]',
  -1     -- unlimited descriptions (same as pro)
)
ON CONFLICT (plan) DO UPDATE SET
  scripts_per_month = EXCLUDED.scripts_per_month,
  images_per_month = EXCLUDED.images_per_month,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  descriptions_per_month = EXCLUDED.descriptions_per_month;

-- =============================================
-- STEP 4: Create referral_campaigns table
-- =============================================
CREATE TABLE IF NOT EXISTS referral_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'meta_advanze',
  trial_days INTEGER NOT NULL DEFAULT 90,
  max_signups INTEGER,
  current_signups INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE referral_campaigns ENABLE ROW LEVEL SECURITY;

-- Only admins can manage campaigns, everyone can read (for validation)
CREATE POLICY "Anyone can read active campaigns" ON referral_campaigns
  FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Admins can manage campaigns" ON referral_campaigns
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- =============================================
-- STEP 5: Create referral_signups table (audit trail)
-- =============================================
CREATE TABLE IF NOT EXISTS referral_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES referral_campaigns(id),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  signed_up_at TIMESTAMPTZ DEFAULT NOW(),
  trial_ends_at TIMESTAMPTZ NOT NULL,
  converted_to_paid BOOLEAN DEFAULT FALSE,
  UNIQUE(campaign_id, user_id)
);

ALTER TABLE referral_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own referral signup" ON referral_signups
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can view all referral signups" ON referral_signups
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- =============================================
-- STEP 6: Insert the Meta AdVance campaign
-- =============================================
INSERT INTO referral_campaigns (code, name, plan, trial_days, max_signups, is_active, expires_at)
VALUES (
  'META-ADVANZE-2026',
  'Meta AdVance Partner Campaign',
  'meta_advanze',
  90,        -- 3 months
  NULL,      -- unlimited signups (remove cap if needed later)
  TRUE,
  '2026-12-31 23:59:59+00' -- campaign valid through end of 2026
)
ON CONFLICT (code) DO NOTHING;

-- =============================================
-- STEP 7: Create apply_referral_code RPC function
-- Called after signup (both email and Google OAuth)
-- Validates code, upgrades subscription, logs signup
-- =============================================
CREATE OR REPLACE FUNCTION public.apply_referral_code(
  p_user_id UUID,
  p_code TEXT
) RETURNS JSONB AS $$
DECLARE
  v_campaign referral_campaigns%ROWTYPE;
  v_trial_end TIMESTAMPTZ;
  v_existing_referral UUID;
  v_current_plan TEXT;
BEGIN
  -- Check if user already has a referral applied
  SELECT id INTO v_existing_referral
  FROM referral_signups WHERE user_id = p_user_id;
  
  IF v_existing_referral IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Referral already applied');
  END IF;

  -- Check current plan — only apply to free or new users
  SELECT plan INTO v_current_plan
  FROM subscriptions WHERE user_id = p_user_id AND status IN ('active', 'trialing');
  
  IF v_current_plan IS NOT NULL AND v_current_plan NOT IN ('free') THEN
    RETURN jsonb_build_object('success', false, 'error', 'User already has a paid plan');
  END IF;

  -- Validate the campaign code
  SELECT * INTO v_campaign
  FROM referral_campaigns
  WHERE code = UPPER(TRIM(p_code))
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (max_signups IS NULL OR current_signups < max_signups);

  IF v_campaign.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired referral code');
  END IF;

  -- Calculate trial end date
  v_trial_end := NOW() + (v_campaign.trial_days || ' days')::INTERVAL;

  -- Upgrade subscription to trial
  UPDATE subscriptions
  SET plan = v_campaign.plan,
      status = 'trialing',
      trial_ends_at = v_trial_end,
      referral_campaign_id = v_campaign.id,
      current_period_start = NOW(),
      current_period_end = v_trial_end,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  -- If no subscription exists (edge case), create one
  IF NOT FOUND THEN
    INSERT INTO subscriptions (user_id, plan, status, trial_ends_at, referral_campaign_id, current_period_start, current_period_end)
    VALUES (p_user_id, v_campaign.plan, 'trialing', v_trial_end, v_campaign.id, NOW(), v_trial_end);
  END IF;

  -- Log the referral signup
  INSERT INTO referral_signups (campaign_id, user_id, trial_ends_at)
  VALUES (v_campaign.id, p_user_id, v_trial_end)
  ON CONFLICT (campaign_id, user_id) DO NOTHING;

  -- Increment campaign counter
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- STEP 8: Update handle_new_user_subscription to detect referral in metadata
-- For email signups, the referral_code is in raw_user_meta_data
-- For Google OAuth, the frontend calls apply_referral_code separately
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS TRIGGER AS $$
DECLARE
  v_referral_code TEXT;
  v_campaign referral_campaigns%ROWTYPE;
  v_trial_end TIMESTAMPTZ;
BEGIN
  -- Check if user signed up with a referral code (email signup passes it in metadata)
  SELECT raw_user_meta_data->>'referral_code' INTO v_referral_code
  FROM auth.users WHERE id = NEW.id;

  IF v_referral_code IS NOT NULL AND v_referral_code != '' THEN
    -- Validate the referral campaign
    SELECT * INTO v_campaign
    FROM referral_campaigns
    WHERE code = UPPER(TRIM(v_referral_code))
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (max_signups IS NULL OR current_signups < max_signups);

    IF v_campaign.id IS NOT NULL THEN
      -- Valid campaign — create trial subscription
      v_trial_end := NOW() + (v_campaign.trial_days || ' days')::INTERVAL;

      INSERT INTO public.subscriptions (user_id, plan, status, trial_ends_at, referral_campaign_id, current_period_start, current_period_end)
      VALUES (NEW.id, v_campaign.plan, 'trialing', v_trial_end, v_campaign.id, NOW(), v_trial_end)
      ON CONFLICT (user_id) DO NOTHING;

      -- Log referral signup
      INSERT INTO referral_signups (campaign_id, user_id, trial_ends_at)
      VALUES (v_campaign.id, NEW.id, v_trial_end)
      ON CONFLICT DO NOTHING;

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
  RAISE WARNING 'handle_new_user_subscription: failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
DROP TRIGGER IF EXISTS on_profile_created_subscription ON profiles;
CREATE TRIGGER on_profile_created_subscription
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();

-- =============================================
-- STEP 9: Create function to check/expire trials (called lazily by API)
-- =============================================
CREATE OR REPLACE FUNCTION public.check_trial_expiry(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_sub RECORD;
BEGIN
  SELECT * INTO v_sub
  FROM subscriptions
  WHERE user_id = p_user_id AND status = 'trialing';

  IF v_sub IS NULL THEN
    RETURN 'no_trial';
  END IF;

  IF v_sub.trial_ends_at IS NOT NULL AND v_sub.trial_ends_at < NOW() THEN
    -- Trial expired — downgrade to free
    UPDATE subscriptions
    SET plan = 'free', status = 'active', trial_ends_at = NULL, updated_at = NOW()
    WHERE id = v_sub.id;
    RETURN 'expired';
  END IF;

  RETURN 'active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
