-- Fix RLS policy on api_usage_logs to use is_admin from profiles
-- instead of hardcoded email list

-- Drop the old hardcoded policy
DROP POLICY IF EXISTS "Admin can read logs" ON api_usage_logs;

-- Create new policy that checks profiles.is_admin
CREATE POLICY "Admin can read logs"
  ON api_usage_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );
