-- =============================================================================
-- AIIAN chat-shell 06 — AUDIT HARDENING (after 03 + advisors)
-- Revoke trigger RPC from authenticated; add FK covering indexes.
-- Safe to re-run. Does not enable chat_shell.
-- =============================================================================

REVOKE ALL ON FUNCTION public.clear_thread_message_when_session_null() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_chat_session_ownership_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_message_artifact_identity_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_thread_message_when_session_null() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_chat_session_ownership_mutation() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_message_artifact_identity_mutation() TO postgres, service_role;

CREATE INDEX IF NOT EXISTS idx_app_feature_flags_updated_by
  ON public.app_feature_flags (updated_by)
  WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_session_offers_created_by
  ON public.chat_session_offers (created_by);

CREATE INDEX IF NOT EXISTS idx_chat_session_offers_product_business
  ON public.chat_session_offers (product_id, business_id);

CREATE INDEX IF NOT EXISTS idx_message_artifacts_created_by
  ON public.message_artifacts (created_by);

CREATE INDEX IF NOT EXISTS idx_message_artifacts_script_product
  ON public.message_artifacts (script_id, product_id)
  WHERE script_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_artifacts_post_product
  ON public.message_artifacts (post_id, product_id)
  WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_artifacts_image_product
  ON public.message_artifacts (product_image_id, product_id)
  WHERE product_image_id IS NOT NULL;

UPDATE public.app_feature_flags
SET enabled = false, updated_at = now()
WHERE key = 'chat_shell' AND enabled IS DISTINCT FROM false;
