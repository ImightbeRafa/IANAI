-- Migration: Grant Enterprise Plan to Existing Test Accounts
-- Purpose: All existing accounts before payment system launch get permanent enterprise access
-- Date: February 3, 2026

-- Update all existing subscriptions to enterprise plan with permanent status
UPDATE subscriptions
SET 
  plan = 'enterprise',
  status = 'active',
  current_period_end = '2099-12-31'::timestamptz,
  updated_at = now()
WHERE status = 'active';

-- For users who don't have a subscription yet, create one
INSERT INTO subscriptions (user_id, plan, status, current_period_end)
SELECT 
  p.id,
  'enterprise',
  'active',
  '2099-12-31'::timestamptz
FROM profiles p
LEFT JOIN subscriptions s ON s.user_id = p.id
WHERE s.id IS NULL;

-- Set high usage limits for existing users (essentially unlimited)
UPDATE usage
SET 
  scripts_generated = 0,
  images_generated = 0
WHERE user_id IN (
  SELECT user_id FROM subscriptions WHERE plan = 'enterprise'
);

-- Log which users were granted enterprise access
DO $$
DECLARE
  user_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count FROM subscriptions WHERE plan = 'enterprise';
  RAISE NOTICE 'Granted enterprise plan to % existing users', user_count;
END $$;
