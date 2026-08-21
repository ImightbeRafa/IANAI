-- =============================================================================
-- AIIAN chat-shell 02 — FOUNDATION + ROLLOUT (DDL)
-- Target: production AIIAN lstzfxsdmggkoaxfawny
-- MANUAL APPLY ONLY after 01_preflight_read_only.sql review.
-- Does NOT enable chat_shell. Does NOT invite users. Does NOT backfill sessions.
-- Does NOT install RLS policies (see 03_security_overlay.sql).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Abort if chat_shell already enabled (unexpected on AIIAN)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.app_feature_flags') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.app_feature_flags
      WHERE key = 'chat_shell' AND enabled IS TRUE
    ) THEN
      RAISE EXCEPTION 'Refuse apply: app_feature_flags.chat_shell is already enabled on AIIAN';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Supporting unique indexes for composite FKs
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_id_business_id
  ON public.products (id, business_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_id_session_id
  ON public.messages (id, session_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scripts_id_product_id
  ON public.scripts (id, product_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_posts_id_product_id
  ON public.posts (id, product_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_images_id_product_id
  ON public.product_images (id, product_id);

-- ---------------------------------------------------------------------------
-- 2) brand_kits.business_id (additive)
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_kits
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_brand_kits_business_id
  ON public.brand_kits (business_id)
  WHERE business_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_kits_id_business_id
  ON public.brand_kits (id, business_id);

-- ---------------------------------------------------------------------------
-- 3) chat_sessions shell columns + nullable product_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS brand_kit_id uuid REFERENCES public.brand_kits(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS primary_channel text,
  ADD COLUMN IF NOT EXISTS awareness_level text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_sessions'
      AND column_name = 'product_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.chat_sessions ALTER COLUMN product_id DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_requires_product_or_business;
ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_requires_product_or_business
  CHECK (product_id IS NOT NULL OR business_id IS NOT NULL);

ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_primary_channel_check;
ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_primary_channel_check
  CHECK (
    primary_channel IS NULL
    OR primary_channel = ANY (ARRAY['messages'::text, 'website'::text, 'physical'::text])
  );

ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_awareness_level_check;
ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_awareness_level_check
  CHECK (
    awareness_level IS NULL
    OR awareness_level = ANY (ARRAY['cold'::text, 'warm'::text, 'hot'::text])
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_sessions_id_business_id
  ON public.chat_sessions (id, business_id);

ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_product_business_fkey;
ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_product_business_fkey
  FOREIGN KEY (product_id, business_id)
  REFERENCES public.products (id, business_id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE public.chat_sessions
  DROP CONSTRAINT IF EXISTS chat_sessions_brand_kit_business_fkey;
ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_brand_kit_business_fkey
  FOREIGN KEY (brand_kit_id, business_id)
  REFERENCES public.brand_kits (id, business_id)
  DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_business_id
  ON public.chat_sessions (business_id)
  WHERE business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_brand_kit_id
  ON public.chat_sessions (brand_kit_id)
  WHERE brand_kit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated
  ON public.chat_sessions (user_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- 4) chat_session_offers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_session_offers (
  session_id uuid NOT NULL,
  business_id uuid NOT NULL,
  product_id uuid NOT NULL,
  position smallint NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_session_offers_pkey PRIMARY KEY (session_id, product_id),
  CONSTRAINT chat_session_offers_position_range CHECK (position >= 1 AND position <= 5),
  CONSTRAINT chat_session_offers_session_business_fkey
    FOREIGN KEY (session_id, business_id)
    REFERENCES public.chat_sessions (id, business_id)
    ON DELETE CASCADE,
  CONSTRAINT chat_session_offers_product_business_fkey
    FOREIGN KEY (product_id, business_id)
    REFERENCES public.products (id, business_id),
  CONSTRAINT chat_session_offers_session_position_key UNIQUE (session_id, position)
);

CREATE INDEX IF NOT EXISTS idx_chat_session_offers_business_product
  ON public.chat_session_offers (business_id, product_id);

CREATE INDEX IF NOT EXISTS idx_chat_session_offers_session_position
  ON public.chat_session_offers (session_id, position);

COMMENT ON TABLE public.chat_session_offers IS
  'Offer selections for a chat-shell session (max 5). Generation remains 1 offer / 1 usage / call.';

-- ---------------------------------------------------------------------------
-- 5) posts / product_images thread links
--    Corrected semantics: offer/session unlink SET NULL (retain assets).
-- ---------------------------------------------------------------------------
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_id uuid;

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_id uuid;

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_message_session_fkey;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_message_session_fkey
  FOREIGN KEY (message_id, session_id)
  REFERENCES public.messages (id, session_id)
  ON DELETE SET NULL;

ALTER TABLE public.product_images
  DROP CONSTRAINT IF EXISTS product_images_message_session_fkey;
ALTER TABLE public.product_images
  ADD CONSTRAINT product_images_message_session_fkey
  FOREIGN KEY (message_id, session_id)
  REFERENCES public.messages (id, session_id)
  ON DELETE SET NULL;

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_message_requires_session;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_message_requires_session
  CHECK (message_id IS NULL OR session_id IS NOT NULL);

ALTER TABLE public.product_images
  DROP CONSTRAINT IF EXISTS product_images_message_requires_session;
ALTER TABLE public.product_images
  ADD CONSTRAINT product_images_message_requires_session
  CHECK (message_id IS NULL OR session_id IS NOT NULL);

-- ON DELETE SET NULL (not RESTRICT): deleting an offer/session clears links, keeps posts/images.
ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_session_offer_fkey;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_session_offer_fkey
  FOREIGN KEY (session_id, product_id)
  REFERENCES public.chat_session_offers (session_id, product_id)
  ON DELETE SET NULL;

ALTER TABLE public.product_images
  DROP CONSTRAINT IF EXISTS product_images_session_offer_fkey;
ALTER TABLE public.product_images
  ADD CONSTRAINT product_images_session_offer_fkey
  FOREIGN KEY (session_id, product_id)
  REFERENCES public.chat_session_offers (session_id, product_id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_session_id
  ON public.posts (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_message_id
  ON public.posts (message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_images_session_id
  ON public.product_images (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_images_message_id
  ON public.product_images (message_id)
  WHERE message_id IS NOT NULL;

-- When session_id is nullified, force message_id NULL (check companion).
CREATE OR REPLACE FUNCTION public.clear_thread_message_when_session_null()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.session_id IS NULL AND NEW.message_id IS NOT NULL THEN
    NEW.message_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_posts_clear_message_with_session ON public.posts;
CREATE TRIGGER trg_posts_clear_message_with_session
  BEFORE UPDATE OF session_id ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_thread_message_when_session_null();

DROP TRIGGER IF EXISTS trg_product_images_clear_message_with_session ON public.product_images;
CREATE TRIGGER trg_product_images_clear_message_with_session
  BEFORE UPDATE OF session_id ON public.product_images
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_thread_message_when_session_null();

-- ---------------------------------------------------------------------------
-- 6) product_images.kind includes generated (abort if unexpected live values)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad text;
  def text;
BEGIN
  SELECT string_agg(DISTINCT kind, ', ' ORDER BY kind)
  INTO bad
  FROM public.product_images
  WHERE kind NOT IN ('product', 'context', 'generated');

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Refuse kind widen: unexpected product_images.kind values: %', bad;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conrelid = 'public.product_images'::regclass
    AND conname = 'product_images_kind_check';

  -- If an unknown CHECK exists with a different name, human must review preflight.
  ALTER TABLE public.product_images DROP CONSTRAINT IF EXISTS product_images_kind_check;
  ALTER TABLE public.product_images
    ADD CONSTRAINT product_images_kind_check
    CHECK (kind IN ('product', 'context', 'generated'));
END $$;

COMMENT ON COLUMN public.product_images.kind IS
  'product = reference; context = mood/lifestyle; generated = AI output (chat-shell)';

-- ---------------------------------------------------------------------------
-- 7) message_artifacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  artifact_type text NOT NULL,
  script_id uuid,
  post_id uuid,
  product_image_id uuid,
  ordinal smallint NOT NULL,
  action_type text NOT NULL DEFAULT 'generate',
  action_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_artifacts_type_check
    CHECK (artifact_type = ANY (ARRAY['script'::text, 'post'::text, 'image'::text])),
  CONSTRAINT message_artifacts_action_type_check
    CHECK (action_type = ANY (ARRAY['generate'::text, 'regenerate'::text, 'edit'::text, 'enhance'::text, 'optimize'::text])),
  CONSTRAINT message_artifacts_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT message_artifacts_metadata_object_check CHECK (jsonb_typeof(action_metadata) = 'object'),
  CONSTRAINT message_artifacts_target_parity_check CHECK (
    (artifact_type = 'script' AND script_id IS NOT NULL AND post_id IS NULL AND product_image_id IS NULL)
    OR (artifact_type = 'post' AND post_id IS NOT NULL AND script_id IS NULL AND product_image_id IS NULL)
    OR (artifact_type = 'image' AND product_image_id IS NOT NULL AND script_id IS NULL AND post_id IS NULL)
  ),
  CONSTRAINT message_artifacts_message_session_fkey
    FOREIGN KEY (message_id, session_id)
    REFERENCES public.messages (id, session_id)
    ON DELETE CASCADE,
  CONSTRAINT message_artifacts_session_offer_fkey
    FOREIGN KEY (session_id, product_id)
    REFERENCES public.chat_session_offers (session_id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT message_artifacts_script_product_fkey
    FOREIGN KEY (script_id, product_id)
    REFERENCES public.scripts (id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT message_artifacts_post_product_fkey
    FOREIGN KEY (post_id, product_id)
    REFERENCES public.posts (id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT message_artifacts_image_product_fkey
    FOREIGN KEY (product_image_id, product_id)
    REFERENCES public.product_images (id, product_id)
    ON DELETE CASCADE,
  CONSTRAINT message_artifacts_message_ordinal_key UNIQUE (message_id, ordinal)
);

-- Multiple scripts per offer per message (064 intent) — required for count requests.
DROP INDEX IF EXISTS public.uq_message_artifacts_script_per_offer;
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_artifacts_script_id_per_offer
  ON public.message_artifacts (message_id, product_id, script_id)
  WHERE artifact_type = 'script' AND script_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_artifacts_session_created
  ON public.message_artifacts (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_message_artifacts_message_ordinal
  ON public.message_artifacts (message_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_message_artifacts_product_id
  ON public.message_artifacts (product_id);

CREATE OR REPLACE FUNCTION public.prevent_message_artifact_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.session_id IS DISTINCT FROM OLD.session_id
       OR NEW.message_id IS DISTINCT FROM OLD.message_id
       OR NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.artifact_type IS DISTINCT FROM OLD.artifact_type
       OR NEW.script_id IS DISTINCT FROM OLD.script_id
       OR NEW.post_id IS DISTINCT FROM OLD.post_id
       OR NEW.product_image_id IS DISTINCT FROM OLD.product_image_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'message_artifacts identity columns are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_artifacts_immutable ON public.message_artifacts;
CREATE TRIGGER trg_message_artifacts_immutable
  BEFORE UPDATE ON public.message_artifacts
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_message_artifact_identity_mutation();

-- ---------------------------------------------------------------------------
-- 8) Access helpers (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_business_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.id = p_business_id
      AND (
        b.owner_id = auth.uid()
        OR b.client_id IN (
          SELECT c.id
          FROM public.clients c
          JOIN public.team_members tm ON tm.team_id = c.team_id
          WHERE tm.user_id = auth.uid()
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_product(p_product_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_product_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND (
        p.owner_id = auth.uid()
        OR p.client_id IN (
          SELECT c.id
          FROM public.clients c
          JOIN public.team_members tm ON tm.team_id = c.team_id
          WHERE tm.user_id = auth.uid()
        )
        OR p.id IN (
          SELECT pc.product_id
          FROM public.product_collaborators pc
          WHERE pc.status = 'accepted'
            AND (
              pc.user_id = auth.uid()
              OR pc.invited_email = (SELECT profiles.email FROM public.profiles WHERE profiles.id = auth.uid())
            )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_write_product(p_product_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_product_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND (
        p.owner_id = auth.uid()
        OR p.client_id IN (
          SELECT c.id
          FROM public.clients c
          JOIN public.team_members tm ON tm.team_id = c.team_id
          WHERE tm.user_id = auth.uid()
        )
        OR p.id IN (
          SELECT pc.product_id
          FROM public.product_collaborators pc
          WHERE pc.status = 'accepted'
            AND pc.role = 'editor'
            AND (
              pc.user_id = auth.uid()
              OR pc.invited_email = (SELECT profiles.email FROM public.profiles WHERE profiles.id = auth.uid())
            )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_chat_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.chat_sessions%ROWTYPE;
BEGIN
  IF p_session_id IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_session FROM public.chat_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_session.user_id = auth.uid() THEN
    NULL;
  ELSIF v_session.business_id IS NOT NULL AND public.can_access_business(v_session.business_id) THEN
    NULL;
  ELSIF v_session.product_id IS NOT NULL AND public.can_read_product(v_session.product_id) THEN
    NULL;
  ELSE
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.chat_session_offers o
    WHERE o.session_id = p_session_id
      AND NOT public.can_read_product(o.product_id)
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_write_chat_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.chat_sessions%ROWTYPE;
BEGIN
  IF p_session_id IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_session FROM public.chat_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_session.user_id = auth.uid() THEN
    NULL;
  ELSIF v_session.business_id IS NOT NULL AND public.can_access_business(v_session.business_id) THEN
    NULL;
  ELSIF v_session.product_id IS NOT NULL AND public.can_write_product(v_session.product_id) THEN
    NULL;
  ELSE
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.chat_session_offers o
    WHERE o.session_id = p_session_id
      AND NOT public.can_write_product(o.product_id)
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_chat_session_ownership_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'chat_sessions.user_id is immutable after create';
    END IF;
    IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
      RAISE EXCEPTION 'chat_sessions.business_id is immutable after create';
    END IF;
    IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      RAISE EXCEPTION 'chat_sessions.product_id is immutable after create';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_sessions_ownership_immutable ON public.chat_sessions;
CREATE TRIGGER trg_chat_sessions_ownership_immutable
  BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_chat_session_ownership_mutation();

REVOKE ALL ON FUNCTION public.can_access_business(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_product(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_product(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_chat_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_chat_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_message_artifact_identity_mutation() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_chat_session_ownership_mutation() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_thread_message_when_session_null() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_access_business(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_product(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_product(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_chat_session(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_chat_session(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9) Rollout controls (067 intent) — flag stays FALSE
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

-- Hard guarantee: never leave apply with flag on
UPDATE public.app_feature_flags
SET enabled = false, updated_at = now()
WHERE key = 'chat_shell' AND enabled IS DISTINCT FROM false;

COMMIT;
