-- =============================================
-- Migration 053: Fix TiloPay Pipeline
-- - Expand pending_subscriptions CHECK to include 'enterprise', 'image_boost'
-- - Add plan + description columns to payments table
-- - Create payment_transactions table for full audit trail
-- - Add service role policies for payments
-- =============================================

-- =============================================
-- 1. FIX pending_subscriptions CHECK constraint
--    Was: ('starter', 'pro', 'meta_advanze')
--    Now: ('starter', 'pro', 'enterprise', 'meta_advanze', 'image_boost')
-- =============================================
ALTER TABLE pending_subscriptions DROP CONSTRAINT IF EXISTS pending_subscriptions_plan_check;
ALTER TABLE pending_subscriptions ADD CONSTRAINT pending_subscriptions_plan_check
  CHECK (plan IN ('starter', 'pro', 'enterprise', 'meta_advanze', 'image_boost'));

-- =============================================
-- 2. ADD plan + description to payments table
-- =============================================
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS plan TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- =============================================
-- 3. CREATE payment_transactions (full audit trail)
--    Every webhook event is recorded here regardless of outcome
-- =============================================
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  email TEXT,
  event_type TEXT NOT NULL,
  plan TEXT,
  amount DECIMAL(10, 2),
  currency TEXT DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'received',
  tilopay_subscription_id TEXT,
  tilopay_data JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_user ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_email ON payment_transactions(email);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_created ON payment_transactions(created_at DESC);

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own payment transactions" ON payment_transactions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Service role full access payment_transactions" ON payment_transactions
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- 4. ADD service role write policy for payments (if missing)
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payments' AND policyname = 'Service role full access payments'
  ) THEN
    CREATE POLICY "Service role full access payments" ON payments
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- =============================================
-- 5. ADD service role write policy for subscriptions (if missing)
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'Service role full access subscriptions'
  ) THEN
    CREATE POLICY "Service role full access subscriptions" ON subscriptions
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;
