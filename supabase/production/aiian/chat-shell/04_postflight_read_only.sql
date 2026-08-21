-- =============================================================================
-- AIIAN chat-shell 04 — POSTFLIGHT (READ-ONLY)
-- Run after 02 + 03. Expect chat_shell.enabled = false.
-- =============================================================================

SELECT key, enabled, updated_at
FROM public.app_feature_flags
WHERE key = 'chat_shell';
-- MUST be enabled=false

SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'chat_sessions'
  AND column_name IN ('product_id','business_id','brand_kit_id','primary_channel','awareness_level')
ORDER BY 1;

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name IN ('chat_beta_access','preferred_ui')
ORDER BY 1;

SELECT to_regclass('public.chat_session_offers') AS chat_session_offers,
       to_regclass('public.message_artifacts') AS message_artifacts,
       to_regclass('public.app_feature_flags') AS app_feature_flags;

SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.product_images'::regclass
  AND conname IN (
    'product_images_kind_check',
    'product_images_message_requires_session',
    'product_images_session_offer_fkey'
  )
ORDER BY 1;

SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.posts'::regclass
  AND conname IN ('posts_session_offer_fkey','posts_message_requires_session')
ORDER BY 1;

-- Expect ON DELETE SET NULL (session_id) on offer FKs — product_id must remain
SELECT
  c.conname,
  pg_get_constraintdef(c.oid) AS def
FROM pg_constraint c
WHERE c.conname IN ('posts_session_offer_fkey','product_images_session_offer_fkey');
-- def MUST contain: ON DELETE SET NULL (session_id)
-- def MUST NOT be bare ON DELETE SET NULL (that would null product_id)

-- product_images INSERT policy must require can_write_product
SELECT p.polname,
       pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expr
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'product_images'
  AND p.polname = 'Users can insert own product images';
-- with_check_expr MUST include can_write_product

SELECT count(*) AS beta_true
FROM public.profiles
WHERE chat_beta_access IS TRUE;
-- Expect 0 after fresh apply

SELECT count(*) AS prefer_chat
FROM public.profiles
WHERE preferred_ui = 'chat';
-- Expect 0 after fresh apply

SELECT c.relname, c.relrowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('chat_session_offers','message_artifacts','app_feature_flags','chat_sessions')
ORDER BY 1;

SELECT polname
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'chat_sessions'
ORDER BY 1;

-- Rollback (product access only — does not drop schema):
-- UPDATE public.app_feature_flags SET enabled = false, updated_at = now() WHERE key = 'chat_shell';
-- UPDATE public.profiles SET chat_beta_access = false, preferred_ui = 'classic'
--   WHERE email = 'canary@example.com';
