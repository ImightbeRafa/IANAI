-- =============================================
-- Migration 054: Admin RLS policies for billing tables
-- Allows admin users to read all subscriptions, payments,
-- and payment_transactions across all users.
-- =============================================

-- =============================================
-- 1. SUBSCRIPTIONS — admin can read all
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'Admins can view all subscriptions'
  ) THEN
    CREATE POLICY "Admins can view all subscriptions" ON subscriptions
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
      );
  END IF;
END $$;

-- =============================================
-- 2. PAYMENTS — admin can read all
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payments' AND policyname = 'Admins can view all payments'
  ) THEN
    CREATE POLICY "Admins can view all payments" ON payments
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
      );
  END IF;
END $$;

-- =============================================
-- 3. PAYMENT_TRANSACTIONS — admin can read all
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'payment_transactions' AND policyname = 'Admins can view all payment transactions'
  ) THEN
    CREATE POLICY "Admins can view all payment transactions" ON payment_transactions
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
      );
  END IF;
END $$;

-- =============================================
-- 4. PENDING_SUBSCRIPTIONS — admin can read all
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'pending_subscriptions' AND policyname = 'Admins can view all pending subscriptions'
  ) THEN
    CREATE POLICY "Admins can view all pending subscriptions" ON pending_subscriptions
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
      );
  END IF;
END $$;
