-- =============================================
-- Migration 045: AI Style Memory (Dual-Layer)
-- Layer 1: user_ai_memory — global user preferences
-- Layer 2: product_ai_memory — per-product style DNA
-- =============================================

-- =============================================
-- 1. GLOBAL USER MEMORY
-- =============================================
CREATE TABLE IF NOT EXISTS user_ai_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,

  -- AI-synthesized global style guide (~200 words)
  style_summary TEXT,

  -- Raw signal counters
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Sample content from saved/favorited scripts (max 8 each)
  sample_hooks TEXT[] DEFAULT '{}',
  sample_ctas TEXT[] DEFAULT '{}',

  -- Common edit instructions / user input patterns (max 10)
  edit_patterns TEXT[] DEFAULT '{}',

  -- Synthesis tracking
  signals_since_last_synthesis INT DEFAULT 0,
  last_synthesized_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_ai_memory_user ON user_ai_memory(user_id);

-- =============================================
-- 2. PER-PRODUCT MEMORY
-- =============================================
CREATE TABLE IF NOT EXISTS product_ai_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- AI-synthesized product-specific style guide (~150 words)
  style_summary TEXT,

  -- Raw signal counters (hooks_used, structures_used, consciousness_levels, etc.)
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Sample content for this product (max 5 each)
  sample_hooks TEXT[] DEFAULT '{}',
  sample_ctas TEXT[] DEFAULT '{}',

  -- Full saved scripts (max 3, favorites first)
  sample_scripts TEXT[] DEFAULT '{}',

  -- User edit instructions / refinement messages (max 10)
  edit_instructions TEXT[] DEFAULT '{}',

  -- Synthesis tracking
  signals_since_last_synthesis INT DEFAULT 0,
  last_synthesized_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(product_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_product_ai_memory_product ON product_ai_memory(product_id);
CREATE INDEX IF NOT EXISTS idx_product_ai_memory_user ON product_ai_memory(user_id);

-- =============================================
-- 3. RLS
-- =============================================
ALTER TABLE user_ai_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_ai_memory ENABLE ROW LEVEL SECURITY;

-- user_ai_memory: users can manage own rows
DROP POLICY IF EXISTS "Users can view own ai memory" ON user_ai_memory;
CREATE POLICY "Users can view own ai memory"
  ON user_ai_memory FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own ai memory" ON user_ai_memory;
CREATE POLICY "Users can insert own ai memory"
  ON user_ai_memory FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own ai memory" ON user_ai_memory;
CREATE POLICY "Users can update own ai memory"
  ON user_ai_memory FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own ai memory" ON user_ai_memory;
CREATE POLICY "Users can delete own ai memory"
  ON user_ai_memory FOR DELETE USING (user_id = auth.uid());

-- product_ai_memory: users can manage own rows
DROP POLICY IF EXISTS "Users can view own product ai memory" ON product_ai_memory;
CREATE POLICY "Users can view own product ai memory"
  ON product_ai_memory FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own product ai memory" ON product_ai_memory;
CREATE POLICY "Users can insert own product ai memory"
  ON product_ai_memory FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own product ai memory" ON product_ai_memory;
CREATE POLICY "Users can update own product ai memory"
  ON product_ai_memory FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own product ai memory" ON product_ai_memory;
CREATE POLICY "Users can delete own product ai memory"
  ON product_ai_memory FOR DELETE USING (user_id = auth.uid());

-- Service role can manage all (for API synthesis endpoint)
DROP POLICY IF EXISTS "Service role can manage user ai memory" ON user_ai_memory;
CREATE POLICY "Service role can manage user ai memory"
  ON user_ai_memory FOR ALL TO service_role USING (true);

DROP POLICY IF EXISTS "Service role can manage product ai memory" ON product_ai_memory;
CREATE POLICY "Service role can manage product ai memory"
  ON product_ai_memory FOR ALL TO service_role USING (true);

-- =============================================
-- 4. UPDATED_AT TRIGGERS
-- =============================================
DROP TRIGGER IF EXISTS update_user_ai_memory_updated_at ON user_ai_memory;
CREATE TRIGGER update_user_ai_memory_updated_at
  BEFORE UPDATE ON user_ai_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_product_ai_memory_updated_at ON product_ai_memory;
CREATE TRIGGER update_product_ai_memory_updated_at
  BEFORE UPDATE ON product_ai_memory
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- 5. RPC: record_ai_signal
-- Atomically upserts signals into both tables
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

  -- =============================================
  -- UPSERT INTO product_ai_memory
  -- =============================================
  INSERT INTO product_ai_memory (product_id, user_id)
  VALUES (p_product_id, p_user_id)
  ON CONFLICT (product_id, user_id) DO NOTHING;

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

  -- Append hook sample (max 5)
  IF v_hook IS NOT NULL AND v_hook != '' THEN
    UPDATE product_ai_memory
    SET sample_hooks = (SELECT array_agg(h) FROM (
      SELECT unnest(ARRAY[v_hook] || sample_hooks) AS h LIMIT 5
    ) sub)
    WHERE product_id = p_product_id AND user_id = p_user_id;
  END IF;

  -- Append CTA sample (max 5)
  IF v_cta IS NOT NULL AND v_cta != '' THEN
    UPDATE product_ai_memory
    SET sample_ctas = (SELECT array_agg(c) FROM (
      SELECT unnest(ARRAY[v_cta] || sample_ctas) AS c LIMIT 5
    ) sub)
    WHERE product_id = p_product_id AND user_id = p_user_id;
  END IF;

  -- Append script sample (max 3)
  IF v_script IS NOT NULL AND v_script != '' THEN
    UPDATE product_ai_memory
    SET sample_scripts = (SELECT array_agg(s) FROM (
      SELECT unnest(ARRAY[v_script] || sample_scripts) AS s LIMIT 3
    ) sub)
    WHERE product_id = p_product_id AND user_id = p_user_id;
  END IF;

  -- Append instruction (max 10)
  IF v_instruction IS NOT NULL AND v_instruction != '' THEN
    UPDATE product_ai_memory
    SET edit_instructions = (SELECT array_agg(i) FROM (
      SELECT unnest(ARRAY[v_instruction] || edit_instructions) AS i LIMIT 10
    ) sub)
    WHERE product_id = p_product_id AND user_id = p_user_id;
  END IF;

  -- =============================================
  -- UPSERT INTO user_ai_memory (global)
  -- =============================================
  INSERT INTO user_ai_memory (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

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

  -- Append hook to global (max 8)
  IF v_hook IS NOT NULL AND v_hook != '' THEN
    UPDATE user_ai_memory
    SET sample_hooks = (SELECT array_agg(h) FROM (
      SELECT unnest(ARRAY[v_hook] || sample_hooks) AS h LIMIT 8
    ) sub)
    WHERE user_id = p_user_id;
  END IF;

  -- Append CTA to global (max 8)
  IF v_cta IS NOT NULL AND v_cta != '' THEN
    UPDATE user_ai_memory
    SET sample_ctas = (SELECT array_agg(c) FROM (
      SELECT unnest(ARRAY[v_cta] || sample_ctas) AS c LIMIT 8
    ) sub)
    WHERE user_id = p_user_id;
  END IF;

  -- Append instruction to global (max 10)
  IF v_instruction IS NOT NULL AND v_instruction != '' THEN
    UPDATE user_ai_memory
    SET edit_patterns = (SELECT array_agg(p) FROM (
      SELECT unnest(ARRAY[v_instruction] || edit_patterns) AS p LIMIT 10
    ) sub)
    WHERE user_id = p_user_id;
  END IF;

END;
$$;
