-- Preview-only: allow multiple script artifacts per offer per assistant message.
-- Required for S1 natural-language counts (e.g. "generame 2 de venta") to persist
-- as independent ScriptCards with isolated edit/version chains.
-- Apply on IANAI-preview only. Do NOT apply to production AIIAN.

DROP INDEX IF EXISTS public.uq_message_artifacts_script_per_offer;

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_artifacts_script_id_per_offer
  ON public.message_artifacts (message_id, product_id, script_id)
  WHERE artifact_type = 'script' AND script_id IS NOT NULL;
