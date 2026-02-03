-- =============================================
-- Migration: Subscriptions and Usage Tracking
-- Prepares database for Tilo Pay integration
-- =============================================

-- =============================================
-- 1. SUBSCRIPTIONS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  
  -- Plan info
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing', 'paused')),
  
  -- Billing period
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  
  -- Tilo Pay integration
  tilopay_customer_id TEXT,
  tilopay_subscription_id TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 2. USAGE TRACKING TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  
  -- Period tracking (monthly)
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- Usage counters
  scripts_generated INTEGER DEFAULT 0,
  images_generated INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- One usage record per user per period
  UNIQUE(user_id, period_start)
);

-- =============================================
-- 3. PAYMENT HISTORY TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Payment details
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CRC',
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
  
  -- Tilo Pay reference
  tilopay_payment_id TEXT,
  tilopay_invoice_id TEXT,
  
  -- Metadata
  payment_method TEXT,
  description TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 4. PLAN LIMITS TABLE (reference data)
-- =============================================
CREATE TABLE IF NOT EXISTS plan_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan TEXT NOT NULL UNIQUE CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  
  -- Limits
  scripts_per_month INTEGER NOT NULL,
  images_per_month INTEGER NOT NULL,
  max_team_members INTEGER NOT NULL,
  max_clients INTEGER NOT NULL,
  max_products INTEGER NOT NULL,
  
  -- Pricing (in CRC)
  price_monthly DECIMAL(10, 2),
  price_yearly DECIMAL(10, 2),
  
  -- Features
  features JSONB DEFAULT '[]'::jsonb
);

-- Insert default plan limits
INSERT INTO plan_limits (plan, scripts_per_month, images_per_month, max_team_members, max_clients, max_products, price_monthly, price_yearly, features)
VALUES 
  ('free', 10, 5, 1, 1, 3, 0, 0, '["basic_scripts", "email_support"]'),
  ('starter', 100, 50, 3, 5, 15, 9900, 99000, '["basic_scripts", "images", "priority_support"]'),
  ('pro', 500, 200, 10, 25, 100, 29900, 299000, '["advanced_scripts", "images", "priority_support", "analytics"]'),
  ('enterprise', -1, -1, -1, -1, -1, NULL, NULL, '["unlimited", "dedicated_support", "custom_integrations", "api_access"]')
ON CONFLICT (plan) DO UPDATE SET
  scripts_per_month = EXCLUDED.scripts_per_month,
  images_per_month = EXCLUDED.images_per_month,
  max_team_members = EXCLUDED.max_team_members,
  max_clients = EXCLUDED.max_clients,
  max_products = EXCLUDED.max_products,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  features = EXCLUDED.features;

-- =============================================
-- 5. INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_team_id ON subscriptions(team_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_period ON usage(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);

-- =============================================
-- 6. ROW LEVEL SECURITY
-- =============================================
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;

-- Subscriptions: Users can view their own, team owners can manage team subscription
CREATE POLICY "Users can view own subscription" ON subscriptions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can manage own subscription" ON subscriptions
  FOR ALL USING (user_id = auth.uid());

-- Usage: Users can view their own usage
CREATE POLICY "Users can view own usage" ON usage
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "System can manage usage" ON usage
  FOR ALL USING (user_id = auth.uid());

-- Payments: Users can view their own payments
CREATE POLICY "Users can view own payments" ON payments
  FOR SELECT USING (user_id = auth.uid());

-- Plan limits: Everyone can read (public reference data)
CREATE POLICY "Anyone can read plan limits" ON plan_limits
  FOR SELECT USING (true);

-- =============================================
-- 7. AUTO-CREATE FREE SUBSCRIPTION ON SIGNUP
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS TRIGGER AS $$
BEGIN
  -- Create free subscription for new user
  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active');
  
  -- Initialize usage tracking for current month
  INSERT INTO public.usage (user_id, period_start, period_end)
  VALUES (
    NEW.id,
    date_trunc('month', NOW())::date,
    (date_trunc('month', NOW()) + interval '1 month' - interval '1 day')::date
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger (runs after profile is created)
DROP TRIGGER IF EXISTS on_profile_created_subscription ON profiles;
CREATE TRIGGER on_profile_created_subscription
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();

-- =============================================
-- 8. HELPER FUNCTIONS
-- =============================================

-- Function to check if user can perform an action based on their plan
CREATE OR REPLACE FUNCTION public.check_usage_limit(
  p_user_id UUID,
  p_action TEXT -- 'script' or 'image'
) RETURNS BOOLEAN AS $$
DECLARE
  v_plan TEXT;
  v_limit INTEGER;
  v_current_usage INTEGER;
BEGIN
  -- Get user's current plan
  SELECT plan INTO v_plan
  FROM subscriptions
  WHERE user_id = p_user_id AND status = 'active'
  LIMIT 1;
  
  IF v_plan IS NULL THEN
    v_plan := 'free';
  END IF;
  
  -- Get limit for this action
  IF p_action = 'script' THEN
    SELECT scripts_per_month INTO v_limit FROM plan_limits WHERE plan = v_plan;
    SELECT scripts_generated INTO v_current_usage 
    FROM usage 
    WHERE user_id = p_user_id AND period_start = date_trunc('month', NOW())::date;
  ELSIF p_action = 'image' THEN
    SELECT images_per_month INTO v_limit FROM plan_limits WHERE plan = v_plan;
    SELECT images_generated INTO v_current_usage 
    FROM usage 
    WHERE user_id = p_user_id AND period_start = date_trunc('month', NOW())::date;
  ELSE
    RETURN FALSE;
  END IF;
  
  -- -1 means unlimited
  IF v_limit = -1 THEN
    RETURN TRUE;
  END IF;
  
  -- Check if under limit
  RETURN COALESCE(v_current_usage, 0) < v_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to increment usage
CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id UUID,
  p_action TEXT
) RETURNS VOID AS $$
BEGIN
  -- Ensure usage record exists for current month
  INSERT INTO usage (user_id, period_start, period_end)
  VALUES (
    p_user_id,
    date_trunc('month', NOW())::date,
    (date_trunc('month', NOW()) + interval '1 month' - interval '1 day')::date
  )
  ON CONFLICT (user_id, period_start) DO NOTHING;
  
  -- Increment the appropriate counter
  IF p_action = 'script' THEN
    UPDATE usage 
    SET scripts_generated = scripts_generated + 1, updated_at = NOW()
    WHERE user_id = p_user_id AND period_start = date_trunc('month', NOW())::date;
  ELSIF p_action = 'image' THEN
    UPDATE usage 
    SET images_generated = images_generated + 1, updated_at = NOW()
    WHERE user_id = p_user_id AND period_start = date_trunc('month', NOW())::date;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 9. UPDATE TIMESTAMPS TRIGGERS
-- =============================================
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_usage_updated_at BEFORE UPDATE ON usage
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
