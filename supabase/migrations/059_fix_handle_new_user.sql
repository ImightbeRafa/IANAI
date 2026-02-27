-- =============================================
-- Migration 059: EMERGENCY FIX — Restore handle_new_user()
--
-- Root cause: The function was overwritten with code from another project
-- that references non-existent columns (whatsapp, bac_account_encrypted, role).
-- This caused ALL signups to fail with 500 "Database error saving new user".
--
-- Restores the correct version from migration 034.
-- =============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_team_id UUID;
  v_full_name TEXT;
BEGIN
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  -- Create profile (most critical step)
  BEGIN
    INSERT INTO public.profiles (id, email, full_name, account_type)
    VALUES (NEW.id, NEW.email, v_full_name, 'team')
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile creation failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
  END;

  -- Create team (secondary)
  BEGIN
    INSERT INTO public.teams (name, owner_id)
    VALUES (v_full_name || '''s Team', NEW.id)
    RETURNING id INTO new_team_id;

    INSERT INTO public.team_members (team_id, user_id, role, joined_at)
    VALUES (new_team_id, NEW.id, 'owner', NOW())
    ON CONFLICT (team_id, user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: team creation failed for user %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger (ensures it points to the updated function)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
