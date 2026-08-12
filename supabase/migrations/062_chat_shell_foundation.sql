-- =============================================
-- Migration 062: Chat-shell foundation (P-1)
-- Additive / backward-compatible schema + RLS for multi-offer sessions.
-- DO NOT apply to production from an agent without human review.
-- Legacy UI keeps working: existing rows retain product_id; createChatSession
-- still inserts product_id. product_id becomes nullable only for Quick sessions
-- (business_id set, product_id null). CHECK requires at least one of them.
-- =============================================

-- ---------------------------------------------------------------------------
-- 0) Helper: products / brand_kits composite uniqueness for shell FKs
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
-- 1) brand_kits: optional business association (additive)
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_kits
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_brand_kits_business_id
  ON public.brand_kits (business_id)
  WHERE business_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_kits_id_business_id
  ON public.brand_kits (id, business_id);

-- ---------------------------------------------------------------------------
-- 2) chat_sessions: business/brand/funnel columns; nullable product_id (Quick)
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

-- MATCH SIMPLE: when business_id IS NULL (legacy), composite FKs are skipped.
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
-- 3) chat_session_offers — max 5 ordered offers, same-business enforced
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
  'Current offer selections for a chat-shell session. Max 5 via position CHECK; sequential generation (1 usage / 1 script card per offer) is an application contract — see ADR 0001.';

-- ---------------------------------------------------------------------------
-- 4) posts / product_images — additive session + message thread links
-- ---------------------------------------------------------------------------
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_id uuid;

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_id uuid;

-- message must belong to the same session when both set
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

-- Thread-linked rows must reference a selected offer (MATCH SIMPLE skips when session_id NULL).
-- RESTRICT (not SET NULL): composite SET NULL would also null product_id and break NOT NULL.
ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_session_offer_fkey;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_session_offer_fkey
  FOREIGN KEY (session_id, product_id)
  REFERENCES public.chat_session_offers (session_id, product_id)
  ON DELETE RESTRICT;

ALTER TABLE public.product_images
  DROP CONSTRAINT IF EXISTS product_images_session_offer_fkey;
ALTER TABLE public.product_images
  ADD CONSTRAINT product_images_session_offer_fkey
  FOREIGN KEY (session_id, product_id)
  REFERENCES public.chat_session_offers (session_id, product_id)
  ON DELETE RESTRICT;

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

-- ---------------------------------------------------------------------------
-- 5) message_artifacts — typed, ordered, immutable product binding
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_artifacts (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
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

-- One script card per offer per assistant message (multi-offer semantics)
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_artifacts_script_per_offer
  ON public.message_artifacts (message_id, product_id)
  WHERE artifact_type = 'script';

CREATE INDEX IF NOT EXISTS idx_message_artifacts_session_created
  ON public.message_artifacts (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_message_artifacts_message_ordinal
  ON public.message_artifacts (message_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_message_artifacts_product_id
  ON public.message_artifacts (product_id);

CREATE INDEX IF NOT EXISTS idx_message_artifacts_script_id
  ON public.message_artifacts (script_id)
  WHERE script_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_artifacts_post_id
  ON public.message_artifacts (post_id)
  WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_artifacts_product_image_id
  ON public.message_artifacts (product_image_id)
  WHERE product_image_id IS NOT NULL;

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

COMMENT ON TABLE public.message_artifacts IS
  'Typed links from chat messages to script/post/image artifacts. product_id is immutable and must match the target row + session offer.';

-- ---------------------------------------------------------------------------
-- 6) Runtime feature flags (chat-shell cutover)
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
  'Runtime cutover flag for /chat shell. Authoritative at runtime — do not rely on VITE_* build-time flags alone.'
)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7) Access helpers (SECURITY DEFINER, fixed search_path)
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

  SELECT * INTO v_session
  FROM public.chat_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Creator always retains access (covers Quick sessions)
  IF v_session.user_id = auth.uid() THEN
    NULL; -- still verify offer products below when present
  ELSIF v_session.business_id IS NOT NULL AND public.can_access_business(v_session.business_id) THEN
    NULL;
  ELSIF v_session.product_id IS NOT NULL AND public.can_read_product(v_session.product_id) THEN
    NULL;
  ELSE
    RETURN false;
  END IF;

  -- Every selected offer product must be readable (definer sees full offer set)
  IF EXISTS (
    SELECT 1
    FROM public.chat_session_offers o
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

  SELECT * INTO v_session
  FROM public.chat_sessions
  WHERE id = p_session_id;

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
    SELECT 1
    FROM public.chat_session_offers o
    WHERE o.session_id = p_session_id
      AND NOT public.can_write_product(o.product_id)
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_business(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_product(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_product(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_chat_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_chat_session(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_message_artifact_identity_mutation() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_access_business(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_product(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_product(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_chat_session(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_chat_session(uuid) TO authenticated, service_role;

-- Explicit table grants (Supabase default ACLs usually cover this; keep idempotent)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_session_offers TO authenticated, service_role;
GRANT SELECT, INSERT ON public.message_artifacts TO authenticated, service_role;
GRANT SELECT ON public.app_feature_flags TO authenticated, service_role;
GRANT ALL ON public.chat_session_offers TO service_role;
GRANT ALL ON public.message_artifacts TO service_role;
GRANT ALL ON public.app_feature_flags TO service_role;

-- ---------------------------------------------------------------------------
-- 8) RLS policies — extend carefully; no cross-brand leaks
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_session_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_feature_flags ENABLE ROW LEVEL SECURITY;

-- chat_sessions: replace product-only policies with helper-based ones
DROP POLICY IF EXISTS "Users can manage own sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Users can view own sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "chat_sessions_select" ON public.chat_sessions;
DROP POLICY IF EXISTS "chat_sessions_insert" ON public.chat_sessions;
DROP POLICY IF EXISTS "chat_sessions_update" ON public.chat_sessions;
DROP POLICY IF EXISTS "chat_sessions_delete" ON public.chat_sessions;

CREATE POLICY "chat_sessions_select"
  ON public.chat_sessions
  FOR SELECT
  TO authenticated
  USING (public.can_read_chat_session(id));

CREATE POLICY "chat_sessions_insert"
  ON public.chat_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (product_id IS NOT NULL OR business_id IS NOT NULL)
    AND (product_id IS NULL OR public.can_write_product(product_id))
    AND (business_id IS NULL OR public.can_access_business(business_id))
  );

CREATE POLICY "chat_sessions_update"
  ON public.chat_sessions
  FOR UPDATE
  TO authenticated
  USING (public.can_write_chat_session(id))
  WITH CHECK (
    user_id = auth.uid() OR public.can_write_chat_session(id)
  );

CREATE POLICY "chat_sessions_delete"
  ON public.chat_sessions
  FOR DELETE
  TO authenticated
  USING (public.can_write_chat_session(id));

-- messages
DROP POLICY IF EXISTS "Users can add messages" ON public.messages;
DROP POLICY IF EXISTS "Users can view session messages" ON public.messages;
DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;

CREATE POLICY "messages_select"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (public.can_read_chat_session(session_id));

CREATE POLICY "messages_insert"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_write_chat_session(session_id));

-- chat_session_offers
DROP POLICY IF EXISTS "chat_session_offers_select" ON public.chat_session_offers;
DROP POLICY IF EXISTS "chat_session_offers_insert" ON public.chat_session_offers;
DROP POLICY IF EXISTS "chat_session_offers_update" ON public.chat_session_offers;
DROP POLICY IF EXISTS "chat_session_offers_delete" ON public.chat_session_offers;

CREATE POLICY "chat_session_offers_select"
  ON public.chat_session_offers
  FOR SELECT
  TO authenticated
  USING (public.can_read_chat_session(session_id));

CREATE POLICY "chat_session_offers_insert"
  ON public.chat_session_offers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.can_write_chat_session(session_id)
    AND public.can_write_product(product_id)
    AND public.can_access_business(business_id)
  );

CREATE POLICY "chat_session_offers_update"
  ON public.chat_session_offers
  FOR UPDATE
  TO authenticated
  USING (public.can_write_chat_session(session_id))
  WITH CHECK (
    public.can_write_chat_session(session_id)
    AND public.can_write_product(product_id)
    AND public.can_access_business(business_id)
  );

CREATE POLICY "chat_session_offers_delete"
  ON public.chat_session_offers
  FOR DELETE
  TO authenticated
  USING (public.can_write_chat_session(session_id));

-- message_artifacts: append-oriented (no authenticated DELETE policy)
DROP POLICY IF EXISTS "message_artifacts_select" ON public.message_artifacts;
DROP POLICY IF EXISTS "message_artifacts_insert" ON public.message_artifacts;

CREATE POLICY "message_artifacts_select"
  ON public.message_artifacts
  FOR SELECT
  TO authenticated
  USING (
    public.can_read_chat_session(session_id)
    AND public.can_read_product(product_id)
  );

CREATE POLICY "message_artifacts_insert"
  ON public.message_artifacts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.can_write_chat_session(session_id)
    AND public.can_write_product(product_id)
  );

-- app_feature_flags: authenticated read; service_role writes via bypass
DROP POLICY IF EXISTS "app_feature_flags_select" ON public.app_feature_flags;
CREATE POLICY "app_feature_flags_select"
  ON public.app_feature_flags
  FOR SELECT
  TO authenticated
  USING (true);

-- brand_kits: additive team read for business-scoped kits only
DROP POLICY IF EXISTS "Team can view business brand kits" ON public.brand_kits;
CREATE POLICY "Team can view business brand kits"
  ON public.brand_kits
  FOR SELECT
  TO authenticated
  USING (
    business_id IS NOT NULL
    AND public.can_access_business(business_id)
  );

-- product_images: tighten INSERT so product must be writable (closes cross-product attach hole)
DROP POLICY IF EXISTS "Users can insert own product images" ON public.product_images;
CREATE POLICY "Users can insert own product images"
  ON public.product_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_write_product(product_id)
    AND (session_id IS NULL OR public.can_write_chat_session(session_id))
  );

DROP POLICY IF EXISTS "Users can delete own product images" ON public.product_images;
CREATE POLICY "Users can delete own product images"
  ON public.product_images
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND public.can_write_product(product_id)
  );

-- Session participants can view thread-linked images they did not upload
DROP POLICY IF EXISTS "Session readers can view thread images" ON public.product_images;
CREATE POLICY "Session readers can view thread images"
  ON public.product_images
  FOR SELECT
  TO authenticated
  USING (
    session_id IS NOT NULL
    AND public.can_read_chat_session(session_id)
  );

-- posts: when thread-linked, require session read/write in addition to product access
DROP POLICY IF EXISTS "Session readers can view thread posts" ON public.posts;
CREATE POLICY "Session readers can view thread posts"
  ON public.posts
  FOR SELECT
  TO authenticated
  USING (
    session_id IS NOT NULL
    AND public.can_read_chat_session(session_id)
  );

-- Keep existing product-scoped posts/scripts policies intact for unlinked legacy rows.
