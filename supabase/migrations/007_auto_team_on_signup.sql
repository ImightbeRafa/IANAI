-- =============================================
-- Migration: Auto-create Team on Signup
-- All new accounts are now team accounts by default
-- =============================================

-- Update the handle_new_user function to:
-- 1. Create profile with account_type = 'team'
-- 2. Auto-create a team for the user
-- 3. Add user as team owner

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_team_id UUID;
BEGIN
  -- Create profile with team account type
  INSERT INTO public.profiles (id, email, full_name, account_type)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    'team'
  );
  
  -- Auto-create a team for the new user
  INSERT INTO public.teams (name, owner_id)
  VALUES (
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)) || '''s Team',
    NEW.id
  )
  RETURNING id INTO new_team_id;
  
  -- Add user as team owner (the handle_new_team trigger will also do this, but we ensure it here)
  INSERT INTO public.team_members (team_id, user_id, role, joined_at)
  VALUES (new_team_id, NEW.id, 'owner', NOW())
  ON CONFLICT (team_id, user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
