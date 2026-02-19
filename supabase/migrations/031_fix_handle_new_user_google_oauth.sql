-- =============================================
-- Migration 031: Fix handle_new_user() for Google OAuth
--
-- Problem: "Database error saving new user" when signing up via Google OAuth.
-- The handle_new_user() trigger chain has no exception handling, so any
-- failure in cascading triggers (subscription, usage, team creation)
-- rolls back the entire auth.users INSERT and prevents signup.
--
-- Fix:
-- 1. Extract full_name from both 'full_name' AND 'name' metadata keys
--    (Google OAuth may use either)
-- 2. Wrap team/team_member creation in exception blocks so profile
--    creation always succeeds even if secondary steps fail
-- 3. Make handle_new_user_subscription() idempotent with ON CONFLICT
-- =============================================

-- =============================================
-- STEP 1: Replace handle_new_user() with robust version
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_team_id UUID;
  v_full_name TEXT;
BEGIN
  -- Extract full_name: try 'full_name' first, then 'name' (Google OAuth uses 'name')
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  -- Create profile (most critical step)
  INSERT INTO public.profiles (id, email, full_name, account_type)
  VALUES (
    NEW.id,
    NEW.email,
    v_full_name,
    'team'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);

  -- Create team (secondary, wrapped in exception handler)
  BEGIN
    INSERT INTO public.teams (name, owner_id)
    VALUES (
      v_full_name || '''s Team',
      NEW.id
    )
    RETURNING id INTO new_team_id;

    -- Add user as team owner
    INSERT INTO public.team_members (team_id, user_id, role, joined_at)
    VALUES (new_team_id, NEW.id, 'owner', NOW())
    ON CONFLICT (team_id, user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: team creation failed for user %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- STEP 2: Make subscription trigger idempotent
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS TRIGGER AS $$
BEGIN
  -- Create free subscription (idempotent)
  INSERT INTO public.subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;

  -- Initialize usage tracking for current month (idempotent)
  INSERT INTO public.usage (user_id, period_start, period_end)
  VALUES (
    NEW.id,
    date_trunc('month', NOW())::date,
    (date_trunc('month', NOW()) + interval '1 month' - interval '1 day')::date
  )
  ON CONFLICT (user_id, period_start) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user_subscription: failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
DROP TRIGGER IF EXISTS on_profile_created_subscription ON profiles;
CREATE TRIGGER on_profile_created_subscription
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();

-- =============================================
-- STEP 3: Make accept_pending_invites robust
-- =============================================
CREATE OR REPLACE FUNCTION accept_pending_invites()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE product_collaborators
  SET user_id = NEW.id, status = 'accepted', accepted_at = NOW()
  WHERE invited_email = NEW.email AND status = 'pending' AND user_id IS NULL;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'accept_pending_invites: failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
DROP TRIGGER IF EXISTS on_profile_created_accept_invites ON profiles;
CREATE TRIGGER on_profile_created_accept_invites
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION accept_pending_invites();
