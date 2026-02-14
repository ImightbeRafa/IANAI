-- =============================================
-- ONE-TIME SCRIPT: Grant admin access + enterprise plan
-- Run this in the Supabase SQL Editor after running migration 019
-- =============================================

-- 1. Set is_admin = true for admin users
UPDATE profiles SET is_admin = TRUE
WHERE email IN (
  'ralauas@gmail.com',
  'admin@advanceai.studio',
  'ian@iankupfer.com',
  'deepsleepp.cr@gmail.com'
);

-- 2. Upsert enterprise subscriptions for admin users (unlimited everything)
INSERT INTO subscriptions (user_id, plan, status)
SELECT p.id, 'enterprise', 'active'
FROM profiles p
WHERE p.email IN (
  'ralauas@gmail.com',
  'admin@advanceai.studio',
  'ian@iankupfer.com',
  'deepsleepp.cr@gmail.com'
)
ON CONFLICT ON CONSTRAINT subscriptions_pkey DO NOTHING;

-- If they already have subscriptions, update them to enterprise
UPDATE subscriptions SET plan = 'enterprise', status = 'active'
WHERE user_id IN (
  SELECT id FROM profiles WHERE email IN (
    'ralauas@gmail.com',
    'admin@advanceai.studio',
    'ian@iankupfer.com',
    'deepsleepp.cr@gmail.com'
  )
);

-- 3. Verify the changes
SELECT p.email, p.is_admin, s.plan, s.status
FROM profiles p
LEFT JOIN subscriptions s ON s.user_id = p.id AND s.status = 'active'
WHERE p.email IN (
  'ralauas@gmail.com',
  'admin@advanceai.studio',
  'ian@iankupfer.com',
  'deepsleepp.cr@gmail.com'
);
