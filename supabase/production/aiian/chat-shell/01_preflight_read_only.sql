-- =============================================================================
-- AIIAN chat-shell PREFLIGHT (READ-ONLY)
-- Project: lstzfxsdmggkoaxfawny
-- Run in SQL editor. Do not wrap in a write transaction that applies DDL.
-- Save the full result set before applying 02/03.
-- =============================================================================

-- 0) Identity + engine (need PG >= 15 for column-targeted SET NULL)
SELECT current_database() AS database,
       current_user AS db_user,
       current_setting('server_version') AS server_version,
       current_setting('server_version_num')::int AS server_version_num,
       now() AT TIME ZONE 'utc' AS queried_at_utc;
-- STOP if server_version_num < 150000
-- STOP unless you opened this editor from project lstzfxsdmggkoaxfawny (AIIAN).
-- current_database() alone does NOT prove project identity.

-- 1) Critical tables exist?
SELECT t AS table_name,
       to_regclass('public.' || t) IS NOT NULL AS exists
FROM unnest(ARRAY[
  'profiles','businesses','products','brand_kits','chat_sessions','messages',
  'scripts','posts','product_images','plan_limits','subscriptions','usage',
  'chat_session_offers','message_artifacts','app_feature_flags'
]) AS t
ORDER BY 1;

-- 2) chat_sessions columns + product_id nullability
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'chat_sessions'
ORDER BY ordinal_position;

-- 3) profiles rollout columns (expect missing before pack)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name IN ('chat_beta_access','preferred_ui','is_admin','email')
ORDER BY 1;

-- 4) brand_kits / posts / product_images shell columns
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'brand_kits' AND column_name = 'business_id')
    OR (table_name = 'posts' AND column_name IN ('session_id','message_id'))
    OR (table_name = 'product_images' AND column_name IN ('session_id','message_id','kind'))
  )
ORDER BY 1, 2;

-- 5) product_images.kind CHECK + live distinct values
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.product_images'::regclass AND contype = 'c'
ORDER BY 1;

SELECT kind, count(*) AS n
FROM public.product_images
GROUP BY kind
ORDER BY 1;

-- STOP APPLY if any kind outside ('product','context') before widening CHECK,
-- or if CHECK already forbids values you need to keep.

-- 6) Existing RLS enabled?
SELECT c.relname, c.relrowsecurity AS rls_on
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN (
    'chat_sessions','messages','posts','product_images','brand_kits','profiles',
    'scripts','businesses','products'
  )
ORDER BY 1;

-- 7) Policy catalog (HUMAN REVIEW — required before 03_security_overlay.sql)
SELECT c.relname AS table_name,
       p.polname AS policy_name,
       CASE p.polcmd
         WHEN 'r' THEN 'SELECT'
         WHEN 'a' THEN 'INSERT'
         WHEN 'w' THEN 'UPDATE'
         WHEN 'd' THEN 'DELETE'
         WHEN '*' THEN 'ALL'
         ELSE p.polcmd::text
       END AS command,
       pg_get_expr(p.polqual, p.polrelid) AS using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expr
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'chat_sessions','messages','posts','product_images','brand_kits','profiles',
    'scripts','context_documents','app_feature_flags'
  )
ORDER BY 1, 2;

-- 8) profiles own-row SELECT already present? (068 not needed if yes)
SELECT p.polname, pg_get_expr(p.polqual, p.polrelid) AS using_expr
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'profiles'
ORDER BY 1;

-- 9) Storage policies on post-images
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- 10) Flag state (table may be missing — that is OK before pack)
DO $$
BEGIN
  IF to_regclass('public.app_feature_flags') IS NULL THEN
    RAISE NOTICE 'app_feature_flags missing (expected before pack)';
  ELSE
    RAISE NOTICE 'app_feature_flags present — inspect SELECT below; abort apply if chat_shell enabled unexpectedly';
  END IF;
END $$;

SELECT key, enabled, updated_at
FROM public.app_feature_flags
WHERE key = 'chat_shell';
-- If this errors because table missing, that is expected.

-- 11) Helper functions already exist?
SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'can_access_business','can_read_product','can_write_product',
    'can_read_chat_session','can_write_chat_session',
    'prevent_chat_session_ownership_mutation',
    'prevent_message_artifact_identity_mutation',
    'protect_chat_beta_access','get_usage_limits'
  )
ORDER BY 1;

-- 12) Scale sanity (read-only counts)
SELECT 'profiles' AS rel, count(*) FROM public.profiles
UNION ALL SELECT 'businesses', count(*) FROM public.businesses
UNION ALL SELECT 'products', count(*) FROM public.products
UNION ALL SELECT 'chat_sessions', count(*) FROM public.chat_sessions
UNION ALL SELECT 'posts', count(*) FROM public.posts
UNION ALL SELECT 'product_images', count(*) FROM public.product_images;
