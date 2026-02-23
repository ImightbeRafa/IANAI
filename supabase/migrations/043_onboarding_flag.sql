-- Add onboarding completion flag to profiles
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS has_completed_onboarding BOOLEAN DEFAULT FALSE;
