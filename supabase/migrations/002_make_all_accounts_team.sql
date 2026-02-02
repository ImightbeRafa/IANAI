-- Migration: Make all existing accounts team type
-- Date: February 2, 2026
-- Purpose: Update all existing profiles to have account_type = 'team'

-- Update all existing profiles to team type
UPDATE profiles 
SET account_type = 'team', 
    updated_at = NOW()
WHERE account_type = 'single';

-- Create teams for users who don't have one yet
INSERT INTO teams (name, owner_id)
SELECT 
  COALESCE(p.full_name, p.email) || '''s Team' as name,
  p.id as owner_id
FROM profiles p
WHERE p.account_type = 'team'
  AND NOT EXISTS (
    SELECT 1 FROM teams t WHERE t.owner_id = p.id
  );

-- Add owners as team admins if not already members
INSERT INTO team_members (team_id, user_id, role)
SELECT 
  t.id as team_id,
  t.owner_id as user_id,
  'admin' as role
FROM teams t
WHERE NOT EXISTS (
  SELECT 1 FROM team_members tm 
  WHERE tm.team_id = t.id AND tm.user_id = t.owner_id
);
