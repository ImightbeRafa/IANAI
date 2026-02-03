-- Migration: Pending Subscriptions Table
-- Purpose: Track subscription attempts for webhook matching
-- Date: February 3, 2026

-- Table to store pending subscriptions (before payment confirmation)
CREATE TABLE IF NOT EXISTS pending_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  email TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('starter', 'pro')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for quick lookup by email (used in webhook matching)
CREATE INDEX IF NOT EXISTS idx_pending_subscriptions_email ON pending_subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_pending_subscriptions_status ON pending_subscriptions(status);

-- RLS policies
ALTER TABLE pending_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own pending subscriptions
CREATE POLICY "Users can view own pending subscriptions"
  ON pending_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can do everything (for API/webhook operations)
CREATE POLICY "Service role full access to pending_subscriptions"
  ON pending_subscriptions FOR ALL
  USING (auth.role() = 'service_role');
