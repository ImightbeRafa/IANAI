-- =============================================
-- Migration 047: AI Memory Evolution
-- Adds avoid_patterns, edit_transformations, and
-- updates record_ai_signal for quality-gated samples
-- =============================================

-- Add avoid_patterns to both tables
ALTER TABLE user_ai_memory
  ADD COLUMN IF NOT EXISTS avoid_patterns TEXT[] DEFAULT '{}';

ALTER TABLE product_ai_memory
  ADD COLUMN IF NOT EXISTS avoid_patterns TEXT[] DEFAULT '{}';

-- Add edit_transformations (stores JSON strings of before→after pairs)
ALTER TABLE product_ai_memory
  ADD COLUMN IF NOT EXISTS edit_transformations TEXT[] DEFAULT '{}';

-- =============================================
-- REPLACE record_ai_signal with evolved version
-- Now handles:
--   - Bad ratings → move hook/CTA to avoid_patterns
--   - Edit before/after → store transformation, move old hook to avoid
--   - Recency caps (8 hooks, 8 CTAs, 5 scripts, 10 instructions, 15 avoid, 8 transforms)
--   - Deduplication of samples
-- =============================================
CREATE OR REPLACE FUNCTION record_ai_signal(
  p_user_id UUID,
  p_product_id UUID,
  p_signal_type TEXT,
  p_signal_data JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hook TEXT;
  v_cta TEXT;
  v_script TEXT;
  v_instruction TEXT;
  v_signal_key TEXT;
  v_rating TEXT;
  v_before_hook TEXT;
  v_after_hook TEXT;
BEGIN
  -- Security: ensure caller can only write their own signals
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: cannot write signals for another user';
  END IF;

  -- Extract common fields from signal_data
  v_hook := p_signal_data->>'hook';
  v_cta := p_signal_data->>'cta';
  v_script := p_signal_data->>'script';
  v_instruction := p_signal_data->>'instruction';
  v_signal_key := p_signal_data->>'signal_key';
  v_rating := p_signal_data->>'rating';
  v_before_hook := p_signal_data->>'before_hook';
  v_after_hook := p_signal_data->>'after_hook';

  -- =============================================
  -- UPSERT INTO BOTH TABLES (must happen before any updates)
  -- =============================================
  INSERT INTO product_ai_memory (product_id, user_id)
  VALUES (p_product_id, p_user_id)
  ON CONFLICT (product_id, user_id) DO NOTHING;

  INSERT INTO user_ai_memory (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Increment signal counter
  IF v_signal_key IS NOT NULL THEN
    UPDATE product_ai_memory
    SET signals = jsonb_set(
      signals,
      ARRAY[v_signal_key],
      to_jsonb(COALESCE((signals->>v_signal_key)::int, 0) + 1)
    ),
    signals_since_last_synthesis = signals_since_last_synthesis + 1
    WHERE product_id = p_product_id AND user_id = p_user_id;
  ELSE
    UPDATE product_ai_memory
    SET signals_since_last_synthesis = signals_since_last_synthesis + 1
    WHERE product_id = p_product_id AND user_id = p_user_id;
  END IF;

  -- =============================================
  -- QUALITY-GATED LOGIC: BAD RATING
  -- Move hook/CTA to avoid_patterns, remove from samples
  -- =============================================
  IF p_signal_type = 'script_rated' AND v_rating = 'bad' THEN
    -- Move hook to avoid_patterns if present
    IF v_hook IS NOT NULL AND v_hook != '' THEN
      UPDATE product_ai_memory
      SET sample_hooks = array_remove(sample_hooks, v_hook),
          avoid_patterns = (SELECT array_agg(a) FROM (
            SELECT unnest(ARRAY[v_hook] || avoid_patterns) AS a LIMIT 15
          ) sub)
      WHERE product_id = p_product_id AND user_id = p_user_id;

      -- Also update global
      UPDATE user_ai_memory
      SET sample_hooks = array_remove(sample_hooks, v_hook),
          avoid_patterns = (SELECT array_agg(a) FROM (
            SELECT unnest(ARRAY[v_hook] || avoid_patterns) AS a LIMIT 15
          ) sub)
      WHERE user_id = p_user_id;
    END IF;

    -- Move CTA to avoid_patterns if present
    IF v_cta IS NOT NULL AND v_cta != '' THEN
      UPDATE product_ai_memory
      SET sample_ctas = array_remove(sample_ctas, v_cta),
          avoid_patterns = (SELECT array_agg(a) FROM (
            SELECT unnest(ARRAY[v_cta] || avoid_patterns) AS a LIMIT 15
          ) sub)
      WHERE product_id = p_product_id AND user_id = p_user_id;

      UPDATE user_ai_memory
      SET sample_ctas = array_remove(sample_ctas, v_cta),
          avoid_patterns = (SELECT array_agg(a) FROM (
            SELECT unnest(ARRAY[v_cta] || avoid_patterns) AS a LIMIT 15
          ) sub)
      WHERE user_id = p_user_id;
    END IF;

    -- Increment global signal counter before returning
    IF v_signal_key IS NOT NULL THEN
      UPDATE user_ai_memory
      SET signals = jsonb_set(
        signals,
        ARRAY[v_signal_key],
        to_jsonb(COALESCE((signals->>v_signal_key)::int, 0) + 1)
      ),
      signals_since_last_synthesis = signals_since_last_synthesis + 1
      WHERE user_id = p_user_id;
    END IF;

    -- Early return — bad-rated content should NOT be added to samples
    RETURN;
  END IF;

  -- =============================================
  -- EDIT TRANSFORMATION TRACKING
  -- When edit_manual fires with before_hook/after_hook:
  --   - Store the transformation
  --   - Move old hook to avoid_patterns
  --   - Add new hook to samples (replacing old)
  -- =============================================
  IF p_signal_type = 'edit_manual' AND v_before_hook IS NOT NULL AND v_after_hook IS NOT NULL THEN
    UPDATE product_ai_memory
    SET
      -- Remove old hook from samples
      sample_hooks = array_remove(sample_hooks, v_before_hook),
      -- Add old hook to avoid_patterns (it was explicitly changed)
      avoid_patterns = (SELECT array_agg(a) FROM (
        SELECT unnest(ARRAY[v_before_hook] || avoid_patterns) AS a LIMIT 15
      ) sub),
      -- Store the transformation as properly-escaped JSON string
      edit_transformations = (SELECT array_agg(t) FROM (
        SELECT unnest(
          ARRAY[jsonb_build_object('before', v_before_hook, 'after', v_after_hook)::text]
          || edit_transformations
        ) AS t LIMIT 8
      ) sub)
    WHERE product_id = p_product_id AND user_id = p_user_id;

    -- Also move old hook to global avoid_patterns
    UPDATE user_ai_memory
    SET sample_hooks = array_remove(sample_hooks, v_before_hook),
        avoid_patterns = (SELECT array_agg(a) FROM (
          SELECT unnest(ARRAY[v_before_hook] || avoid_patterns) AS a LIMIT 15
        ) sub)
    WHERE user_id = p_user_id;
  END IF;

  -- =============================================
  -- STANDARD SAMPLE APPENDING (with dedup + caps)
  -- Only for good-rated or non-rated content
  -- =============================================

  -- Append hook sample (max 8, deduplicated)
  IF v_hook IS NOT NULL AND v_hook != '' THEN
    UPDATE product_ai_memory
    SET sample_hooks = (SELECT array_agg(DISTINCT h) FROM (
      SELECT unnest(ARRAY[v_hook] || sample_hooks) AS h LIMIT 8
    ) sub)
    WHERE product_id = p_product_id AND user_id = p_user_id
      AND NOT (v_hook = ANY(sample_hooks));
  END IF;

  -- Append CTA sample (max 8, deduplicated)
  IF v_cta IS NOT NULL AND v_cta != '' THEN
    UPDATE product_ai_memory
    SET sample_ctas = (SELECT array_agg(DISTINCT c) FROM (
      SELECT unnest(ARRAY[v_cta] || sample_ctas) AS c LIMIT 8
    ) sub)
    WHERE product_id = p_product_id AND user_id = p_user_id
      AND NOT (v_cta = ANY(sample_ctas));
  END IF;

  -- Append script sample (max 5)
  IF v_script IS NOT NULL AND v_script != '' THEN
    UPDATE product_ai_memory
    SET sample_scripts = (SELECT array_agg(s) FROM (
      SELECT unnest(ARRAY[v_script] || sample_scripts) AS s LIMIT 5
    ) sub)
    WHERE product_id = p_product_id AND user_id = p_user_id;
  END IF;

  -- Append instruction (max 10, deduplicated)
  IF v_instruction IS NOT NULL AND v_instruction != '' THEN
    UPDATE product_ai_memory
    SET edit_instructions = (SELECT array_agg(DISTINCT i) FROM (
      SELECT unnest(ARRAY[v_instruction] || edit_instructions) AS i LIMIT 10
    ) sub)
    WHERE product_id = p_product_id AND user_id = p_user_id
      AND NOT (v_instruction = ANY(edit_instructions));
  END IF;

  -- =============================================
  -- GLOBAL SIGNAL TRACKING
  -- (user_ai_memory row already created above)
  -- =============================================

  -- Increment global signal counter
  IF v_signal_key IS NOT NULL THEN
    UPDATE user_ai_memory
    SET signals = jsonb_set(
      signals,
      ARRAY[v_signal_key],
      to_jsonb(COALESCE((signals->>v_signal_key)::int, 0) + 1)
    ),
    signals_since_last_synthesis = signals_since_last_synthesis + 1
    WHERE user_id = p_user_id;
  ELSE
    UPDATE user_ai_memory
    SET signals_since_last_synthesis = signals_since_last_synthesis + 1
    WHERE user_id = p_user_id;
  END IF;

  -- Append hook to global (max 8, deduplicated)
  IF v_hook IS NOT NULL AND v_hook != '' THEN
    UPDATE user_ai_memory
    SET sample_hooks = (SELECT array_agg(DISTINCT h) FROM (
      SELECT unnest(ARRAY[v_hook] || sample_hooks) AS h LIMIT 8
    ) sub)
    WHERE user_id = p_user_id
      AND NOT (v_hook = ANY(sample_hooks));
  END IF;

  -- Append CTA to global (max 8, deduplicated)
  IF v_cta IS NOT NULL AND v_cta != '' THEN
    UPDATE user_ai_memory
    SET sample_ctas = (SELECT array_agg(DISTINCT c) FROM (
      SELECT unnest(ARRAY[v_cta] || sample_ctas) AS c LIMIT 8
    ) sub)
    WHERE user_id = p_user_id
      AND NOT (v_cta = ANY(sample_ctas));
  END IF;

  -- Append instruction to global (max 10, deduplicated)
  IF v_instruction IS NOT NULL AND v_instruction != '' THEN
    UPDATE user_ai_memory
    SET edit_patterns = (SELECT array_agg(DISTINCT p) FROM (
      SELECT unnest(ARRAY[v_instruction] || edit_patterns) AS p LIMIT 10
    ) sub)
    WHERE user_id = p_user_id
      AND NOT (v_instruction = ANY(edit_patterns));
  END IF;

END;
$$;
