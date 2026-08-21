-- =============================================================================
-- AIIAN chat-shell 03 — SECURITY OVERLAY (RLS / grants)
-- MANUAL APPLY ONLY after:
--   1) 01_preflight policy catalog reviewed by a human
--   2) 02_foundation_and_rollout.sql applied successfully
-- Named DROP POLICY IF EXISTS only — no wildcard drops, no Preview deny-all seeds.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_session_offers TO authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.message_artifacts TO authenticated, service_role;
GRANT SELECT ON public.app_feature_flags TO authenticated, service_role;
GRANT ALL ON public.chat_session_offers TO service_role;
GRANT ALL ON public.message_artifacts TO service_role;
GRANT ALL ON public.app_feature_flags TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_usage_limits'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_usage_limits(uuid) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_usage_limits(uuid) TO service_role';
  END IF;
END $$;

ALTER TABLE public.chat_session_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_kits ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- app_feature_flags: authenticated read-only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "app_feature_flags_select" ON public.app_feature_flags;
CREATE POLICY "app_feature_flags_select"
  ON public.app_feature_flags
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- chat_sessions
-- ---------------------------------------------------------------------------
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
  WITH CHECK (public.can_write_chat_session(id));

CREATE POLICY "chat_sessions_delete"
  ON public.chat_sessions
  FOR DELETE
  TO authenticated
  USING (public.can_write_chat_session(id));

-- ---------------------------------------------------------------------------
-- messages (+ delete for session CASCADE under RLS)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can add messages" ON public.messages;
DROP POLICY IF EXISTS "Users can view session messages" ON public.messages;
DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_delete" ON public.messages;

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

CREATE POLICY "messages_delete"
  ON public.messages
  FOR DELETE
  TO authenticated
  USING (public.can_write_chat_session(session_id));

-- ---------------------------------------------------------------------------
-- chat_session_offers
-- ---------------------------------------------------------------------------
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
  );

CREATE POLICY "chat_session_offers_update"
  ON public.chat_session_offers
  FOR UPDATE
  TO authenticated
  USING (public.can_write_chat_session(session_id))
  WITH CHECK (
    public.can_write_chat_session(session_id)
    AND public.can_write_product(product_id)
  );

CREATE POLICY "chat_session_offers_delete"
  ON public.chat_session_offers
  FOR DELETE
  TO authenticated
  USING (public.can_write_chat_session(session_id));

-- ---------------------------------------------------------------------------
-- message_artifacts (append + delete for session cleanup)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "message_artifacts_select" ON public.message_artifacts;
DROP POLICY IF EXISTS "message_artifacts_insert" ON public.message_artifacts;
DROP POLICY IF EXISTS "message_artifacts_delete" ON public.message_artifacts;

CREATE POLICY "message_artifacts_select"
  ON public.message_artifacts
  FOR SELECT
  TO authenticated
  USING (public.can_read_chat_session(session_id));

CREATE POLICY "message_artifacts_insert"
  ON public.message_artifacts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.can_write_chat_session(session_id)
    AND public.can_write_product(product_id)
  );

CREATE POLICY "message_artifacts_delete"
  ON public.message_artifacts
  FOR DELETE
  TO authenticated
  USING (public.can_write_chat_session(session_id));

-- ---------------------------------------------------------------------------
-- brand_kits owner CRUD (+ optional team read by business)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own brand kits" ON public.brand_kits;
DROP POLICY IF EXISTS "Users can insert own brand kits" ON public.brand_kits;
DROP POLICY IF EXISTS "Users can update own brand kits" ON public.brand_kits;
DROP POLICY IF EXISTS "Users can delete own brand kits" ON public.brand_kits;
DROP POLICY IF EXISTS "Team can view business brand kits" ON public.brand_kits;

CREATE POLICY "Users can view own brand kits"
  ON public.brand_kits
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own brand kits"
  ON public.brand_kits
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own brand kits"
  ON public.brand_kits
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own brand kits"
  ON public.brand_kits
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Team can view business brand kits"
  ON public.brand_kits
  FOR SELECT
  TO authenticated
  USING (
    business_id IS NOT NULL
    AND public.can_access_business(business_id)
  );

-- ---------------------------------------------------------------------------
-- product_images: keep classic owner paths; add thread + update-for-clear
-- Review preflight names; DROP IF EXISTS listed aliases only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own product images" ON public.product_images;
DROP POLICY IF EXISTS "Users can insert own product images" ON public.product_images;
DROP POLICY IF EXISTS "Users can delete own product images" ON public.product_images;
DROP POLICY IF EXISTS "Users can update own product images" ON public.product_images;
DROP POLICY IF EXISTS "product_images_update_own" ON public.product_images;
DROP POLICY IF EXISTS "Session readers can view thread images" ON public.product_images;

CREATE POLICY "Users can view own product images"
  ON public.product_images
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Session readers can view thread images"
  ON public.product_images
  FOR SELECT
  TO authenticated
  USING (
    session_id IS NOT NULL
    AND public.can_read_chat_session(session_id)
  );

CREATE POLICY "Users can insert own product images"
  ON public.product_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (session_id IS NULL OR public.can_write_chat_session(session_id))
  );

CREATE POLICY "product_images_update_own"
  ON public.product_images
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own product images"
  ON public.product_images
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- posts: thread read + thread-clear update (retain row when unlinking)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Session readers can view thread posts" ON public.posts;
DROP POLICY IF EXISTS "posts_update_thread_clear" ON public.posts;

CREATE POLICY "Session readers can view thread posts"
  ON public.posts
  FOR SELECT
  TO authenticated
  USING (
    session_id IS NOT NULL
    AND public.can_read_chat_session(session_id)
  );

CREATE POLICY "posts_update_thread_clear"
  ON public.posts
  FOR UPDATE
  TO authenticated
  USING (
    public.can_write_chat_session(session_id)
    OR (session_id IS NULL AND created_by = auth.uid())
  )
  WITH CHECK (
    session_id IS NULL
    OR public.can_write_chat_session(session_id)
  );

-- ---------------------------------------------------------------------------
-- scripts delete soften (session cleanup) — additive named policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "scripts_delete_session_cleanup" ON public.scripts;
CREATE POLICY "scripts_delete_session_cleanup"
  ON public.scripts
  FOR DELETE
  TO authenticated
  USING (
    public.can_write_product(product_id)
  );

-- ---------------------------------------------------------------------------
-- context_documents delete when present
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.context_documents') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "context_documents_delete" ON public.context_documents';
    EXECUTE $pol$
      CREATE POLICY "context_documents_delete"
        ON public.context_documents
        FOR DELETE
        TO authenticated
        USING (
          session_id IS NOT NULL
          AND public.can_write_chat_session(session_id)
        )
    $pol$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Storage: owner-folder UPDATE on post-images (upsert needs INSERT+SELECT+UPDATE)
-- Path convention: {userId}/{productId}/...
-- Only adds/replaces named policies below — review preflight storage list first.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "chat_shell_post_images_select_own" ON storage.objects;
DROP POLICY IF EXISTS "chat_shell_post_images_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "chat_shell_post_images_update_own" ON storage.objects;
DROP POLICY IF EXISTS "chat_shell_post_images_delete_own" ON storage.objects;

CREATE POLICY "chat_shell_post_images_select_own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'post-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "chat_shell_post_images_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'post-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "chat_shell_post_images_update_own"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'post-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'post-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "chat_shell_post_images_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'post-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
