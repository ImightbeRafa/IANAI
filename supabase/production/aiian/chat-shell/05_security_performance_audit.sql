-- =============================================================================
-- AIIAN chat-shell 05 — SECURITY + PERFORMANCE AUDIT (READ-ONLY)
-- Run on AIIAN after 02 + 03 + 04. Also run Dashboard Advisors (Security +
-- Performance) for project lstzfxsdmggkoaxfawny — do NOT substitute Preview.
-- =============================================================================

-- 1) Engine + identity reminder
SELECT current_setting('server_version') AS server_version,
       now() AT TIME ZONE 'utc' AS audited_at_utc;

-- 2) RLS must be on for every touched public table
SELECT c.relname, c.relrowsecurity AS rls_on, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'chat_sessions','messages','posts','product_images','brand_kits','profiles',
    'scripts','chat_session_offers','message_artifacts','app_feature_flags',
    'businesses','products','context_documents'
  )
ORDER BY 1;
-- STOP if any expected table has rls_on = false

-- 3) Full policy catalog (roles, permissive, USING, WITH CHECK)
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
       CASE WHEN p.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END AS mode,
       ARRAY(
         SELECT r.rolname FROM pg_roles r WHERE r.oid = ANY (p.polroles) ORDER BY 1
       ) AS roles,
       pg_get_expr(p.polqual, p.polrelid) AS using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) AS with_check_expr
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'chat_sessions','messages','posts','product_images','brand_kits','profiles',
    'scripts','chat_session_offers','message_artifacts','app_feature_flags',
    'context_documents'
  )
ORDER BY 1, 2;

-- 4) Storage policies on post-images
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (
    policyname ILIKE '%post_images%'
    OR policyname ILIKE '%post-images%'
    OR coalesce(qual, '') ILIKE '%post-images%'
    OR coalesce(with_check, '') ILIKE '%post-images%'
  )
ORDER BY policyname;

-- 5) Table privileges for anon / authenticated / public
SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'chat_session_offers','message_artifacts','app_feature_flags','chat_sessions',
    'posts','product_images','messages','brand_kits'
  )
  AND grantee IN ('anon', 'authenticated', 'PUBLIC', 'public')
GROUP BY grantee, table_name
ORDER BY 1, 2;
-- anon should not have DML on shell tables

-- 6) SECURITY DEFINER helpers — search_path + execute grants
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.proconfig AS config,
       r.rolname AS owner
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.proname IN (
    'can_access_business','can_read_product','can_write_product',
    'can_read_chat_session','can_write_chat_session',
    'prevent_chat_session_ownership_mutation',
    'prevent_message_artifact_identity_mutation',
    'protect_chat_beta_access','clear_thread_message_when_session_null'
  )
ORDER BY 1;
-- Expect security_definer=true and config includes search_path=public

SELECT p.proname,
       r.rolname AS grantee,
       has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname IN (
    'can_access_business','can_read_product','can_write_product',
    'can_read_chat_session','can_write_chat_session'
  )
  AND r.rolname IN ('anon', 'authenticated', 'PUBLIC', 'public', 'service_role')
ORDER BY 1, 2;
-- anon / PUBLIC should not execute these helpers

-- 7) Flag still off; no invites
SELECT key, enabled FROM public.app_feature_flags WHERE key = 'chat_shell';
SELECT count(*) FILTER (WHERE chat_beta_access) AS beta_true,
       count(*) FILTER (WHERE preferred_ui = 'chat') AS prefer_chat
FROM public.profiles;

-- 8) Indexes supporting new FKs / hot paths
SELECT c.relname AS table_name,
       i.relname AS index_name,
       pg_get_indexdef(i.oid) AS indexdef,
       ix.indisvalid AS valid,
       ix.indisready AS ready
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class c ON c.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'chat_sessions','chat_session_offers','message_artifacts','posts','product_images','brand_kits'
  )
ORDER BY 1, 2;
-- STOP if any valid=false

-- 9) FK constraints on shell objects
SELECT conrelid::regclass AS table_name,
       conname,
       pg_get_constraintdef(oid) AS def,
       convalidated AS validated
FROM pg_constraint
WHERE contype = 'f'
  AND conrelid::regclass::text IN (
    'public.chat_sessions','public.chat_session_offers','public.message_artifacts',
    'public.posts','public.product_images','public.brand_kits'
  )
ORDER BY 1, 2;
-- Expect posts/product_images session_offer_fkey: ON DELETE SET NULL (session_id)

-- 10) Invalid nullability still enforced on classic ownership columns
SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'posts' AND column_name = 'product_id')
    OR (table_name = 'product_images' AND column_name = 'product_id')
    OR (table_name = 'chat_sessions' AND column_name IN ('product_id','business_id'))
  )
ORDER BY 1, 2;
-- posts/product_images.product_id should remain NO; chat_sessions.product_id YES after pack
