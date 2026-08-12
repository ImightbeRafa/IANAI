-- =============================================
-- Preview/local ONLY — do not run against production data casually.
-- Assertions for migration 062_chat_shell_foundation.
-- Wrap destructive persona tests in a transaction and ROLLBACK.
-- =============================================

-- 1) Schema presence
DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM information_schema.columns
          WHERE table_schema='public' AND table_name='chat_sessions'
            AND column_name IN ('business_id','brand_kit_id','primary_channel','awareness_level')) = 4,
    'chat_sessions shell columns missing';
  ASSERT (SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='chat_sessions' AND column_name='product_id') = 'YES',
    'chat_sessions.product_id should be nullable for Quick sessions';
  ASSERT to_regclass('public.chat_session_offers') IS NOT NULL, 'chat_session_offers missing';
  ASSERT to_regclass('public.message_artifacts') IS NOT NULL, 'message_artifacts missing';
  ASSERT to_regclass('public.app_feature_flags') IS NOT NULL, 'app_feature_flags missing';
  ASSERT EXISTS (SELECT 1 FROM public.app_feature_flags WHERE key = 'chat_shell' AND enabled = false),
    'chat_shell flag must exist and default false';
END $$;

-- 2) Legacy invariant: every existing session still has a product_id
DO $$
DECLARE
  v_null_legacy bigint;
BEGIN
  SELECT COUNT(*) INTO v_null_legacy
  FROM public.chat_sessions
  WHERE product_id IS NULL AND business_id IS NULL;
  ASSERT v_null_legacy = 0, 'sessions without product_id and business_id exist';
END $$;

-- 3) Constraint smoke (transactional; rolls back)
BEGIN;

-- Expect fail: both null
DO $$
BEGIN
  BEGIN
    INSERT INTO public.chat_sessions (user_id, title, product_id, business_id)
    VALUES ('00000000-0000-0000-0000-000000000001', 'should-fail', NULL, NULL);
    RAISE EXCEPTION 'expected CHECK failure for null product and business';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

ROLLBACK;

-- 4) S6 — ownership steal must fail (trigger; run as authenticated team writer on preview)
-- Replace the UUIDs with a real session the team writer can update, then:
--
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claim.sub', '<team-writer-user-id>', true);
--   SELECT set_config('request.jwt.claim.role', 'authenticated', true);
--   -- Expect exception: chat_sessions.user_id is immutable after create
--   UPDATE chat_sessions
--     SET user_id = '<team-writer-user-id>'
--     WHERE id = '<session-owned-by-someone-else>';
--   ROLLBACK;
--
-- Also expect failure for:
--   UPDATE chat_sessions SET business_id = '<other-business>' WHERE id = '...';
--   UPDATE chat_sessions SET product_id  = '<other-product>'  WHERE id = '...';
--
-- Control: title-only UPDATE by the same team writer should succeed when can_write_chat_session.

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_chat_sessions_ownership_immutable'
      AND tgrelid = 'public.chat_sessions'::regclass
      AND NOT tgisinternal
  ), 'ownership immutability trigger missing on chat_sessions';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'prevent_chat_session_ownership_mutation'
  ), 'prevent_chat_session_ownership_mutation missing';
END $$;

-- 5) Manual checklist (run as concrete personas on preview):
-- [ ] Legacy product-only insert (business_id NULL, product_id set) succeeds for owner
-- [ ] Quick business-only insert (product_id NULL, business_id set) succeeds for business owner
-- [ ] Cross-business offer insert fails (product.business_id <> session.business_id)
-- [ ] Sixth offer (position=6) fails; duplicate position fails; duplicate product fails
-- [ ] Viewer collaborator: SELECT session/messages OK; INSERT message/offer denied
-- [ ] Unrelated user: no SELECT on foreign brand session/offers/artifacts
-- [ ] message_artifacts identity UPDATE raises
-- [ ] S6: team writer cannot UPDATE user_id / business_id / product_id (ownership steal)
-- [ ] S6: team writer can still UPDATE title/status when can_write_chat_session
-- [ ] Existing unlinked posts/product_images still SELECT/INSERT for owners
-- [ ] /scripts and /posts UI still open existing sessions against preview DB
-- [ ] Supabase security advisor: no RLS-disabled new tables
