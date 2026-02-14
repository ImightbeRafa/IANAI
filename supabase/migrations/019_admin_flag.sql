-- =============================================
-- Migration: Add is_admin flag to profiles
-- Replaces hardcoded admin email lists in frontend code
-- =============================================

-- Add is_admin column (default false, only settable via SQL/service role)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast admin lookups
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON profiles(is_admin) WHERE is_admin = TRUE;

-- Prevent users from setting their own is_admin flag via RLS
-- Drop existing update policy if any, then create one that excludes is_admin
-- Note: The existing RLS policies allow users to update their own profile.
-- We need to ensure is_admin cannot be set by the user.
-- This is enforced by a trigger that resets is_admin on any user-initiated update.

CREATE OR REPLACE FUNCTION protect_admin_flag()
RETURNS TRIGGER AS $$
BEGIN
  -- Only allow admin flag changes from privileged roles (postgres, service_role)
  -- Block changes from authenticated users (normal users via RLS/client)
  IF current_setting('role') = 'authenticated' THEN
    NEW.is_admin := OLD.is_admin;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_admin_flag_trigger ON profiles;
CREATE TRIGGER protect_admin_flag_trigger
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_admin_flag();
