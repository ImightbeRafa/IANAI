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
ON CONFLICT (user_id) DO UPDATE SET
  plan = 'enterprise',
  status = 'active';

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
