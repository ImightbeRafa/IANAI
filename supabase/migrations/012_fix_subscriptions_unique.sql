-- =============================================
-- Migration: Fix subscriptions table unique constraint
-- This ensures upsert works correctly (one subscription per user)
-- =============================================

-- First, remove duplicate subscriptions (keep the most recent one)
DELETE FROM subscriptions a
USING subscriptions b
WHERE a.user_id = b.user_id 
  AND a.created_at < b.created_at;

-- Now add unique constraint on user_id
ALTER TABLE subscriptions 
ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);

-- Also fix the payments table - subscription_id should be nullable
-- since we insert payments before subscription might exist
ALTER TABLE payments 
ALTER COLUMN subscription_id DROP NOT NULL;
