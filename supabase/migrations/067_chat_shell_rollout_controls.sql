-- =============================================
-- Migration 067: Chat-shell rollout controls
-- Additive. Safe for Preview and (after human review) AIIAN.
-- Does NOT enable chat_shell. Does NOT touch chat_sessions.
-- Does NOT copy Preview RLS from 062–066.
-- =============================================

-- ---------------------------------------------------------------------------
-- 1) Per-user entitlement + home preference
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS chat_beta_access boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_ui text NOT NULL DEFAULT 'classic';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_preferred_ui_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_ui_check
  CHECK (preferred_ui = ANY (ARRAY['classic'::text, 'chat'::text]));

COMMENT ON COLUMN public.profiles.chat_beta_access IS
  'Ops-only invite to the chat shell. Users cannot self-grant. Default false.';
COMMENT ON COLUMN public.profiles.preferred_ui IS
  'Home UI for invited testers: classic | chat. Does not grant access.';

-- ---------------------------------------------------------------------------
-- 2) Clients may change preferred_ui; they cannot flip chat_beta_access
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_chat_beta_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
      NEW.chat_beta_access := false;
      IF NEW.preferred_ui IS NULL OR NEW.preferred_ui NOT IN ('classic', 'chat') THEN
        NEW.preferred_ui := 'classic';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.chat_beta_access IS DISTINCT FROM OLD.chat_beta_access
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    NEW.chat_beta_access := OLD.chat_beta_access;
  END IF;

  IF NEW.preferred_ui IS NULL OR NEW.preferred_ui NOT IN ('classic', 'chat') THEN
    NEW.preferred_ui := COALESCE(OLD.preferred_ui, 'classic');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_chat_beta_access ON public.profiles;
CREATE TRIGGER trg_protect_chat_beta_access
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_chat_beta_access();

REVOKE ALL ON FUNCTION public.protect_chat_beta_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_chat_beta_access() TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 3) Flag table + disabled seed (idempotent if 062 already ran)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_feature_flags_config_object_check CHECK (jsonb_typeof(config) = 'object')
);

INSERT INTO public.app_feature_flags (key, enabled, description)
VALUES (
  'chat_shell',
  false,
  'Kill switch for /chat. Enabling does not cut over users; they also need chat_beta_access.'
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.app_feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_feature_flags_select" ON public.app_feature_flags;
CREATE POLICY "app_feature_flags_select"
  ON public.app_feature_flags
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.app_feature_flags TO authenticated, service_role;
GRANT ALL ON public.app_feature_flags TO service_role;
