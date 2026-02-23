-- =============================================
-- Migration 048: AI Memory Evolution — Hybrid Architecture
-- 1. ai_memories: Typed, categorized memory entries (semantic layer)
-- 2. ai_memory_stats: Lightweight reflection tracking
-- 3. Backfill existing style_summary into typed memories
-- =============================================

-- Enable pgvector (free on Supabase, needed for Phase 2 embeddings)
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================
-- 1. TYPED MEMORIES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS ai_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE, -- NULL = global memory
  memory_type TEXT NOT NULL,       -- 'preference' | 'anti_pattern' | 'rule' | 'example' | 'visual_style' | 'fact'
  category TEXT,                   -- 'hooks', 'cta', 'tone', 'vocabulary', 'structure', 'color', 'core_style', etc.
  content TEXT NOT NULL CHECK (length(content) <= 2000),
  metadata JSONB DEFAULT '{}',
  embedding VECTOR(1536),          -- nullable in Phase 1, populated in Phase 2
  confidence FLOAT DEFAULT 0.8,    -- 0.6 (weak signal) to 0.99 (explicit "never do this")
  source TEXT,                     -- 'reflection' | 'user_explicit' | 'signal' | 'backfill'
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 1 indexes (SQL filtering)
CREATE INDEX IF NOT EXISTS idx_ai_memories_user_product ON ai_memories(user_id, product_id);
CREATE INDEX IF NOT EXISTS idx_ai_memories_type ON ai_memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_ai_memories_category ON ai_memories(category);

-- Phase 2 index (pgvector cosine similarity — created now, unused until embeddings populated)
CREATE INDEX IF NOT EXISTS idx_ai_memories_embedding ON ai_memories
  USING hnsw (embedding vector_cosine_ops);

-- =============================================
-- 2. LIGHTWEIGHT STATS TABLE (one row per user+product)
-- Used by reflect-memory.ts and recordAiSignal() for progressive trigger logic.
-- Never touches raw signal tables (user_ai_memory / product_ai_memory).
-- =============================================
CREATE TABLE IF NOT EXISTS ai_memory_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE, -- NULL = global
  total_lifetime_signals INT DEFAULT 0,
  signals_since_last_reflection INT DEFAULT 0,
  last_reflection_at TIMESTAMPTZ,
  UNIQUE NULLS NOT DISTINCT (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_memory_stats_user ON ai_memory_stats(user_id, product_id);

-- =============================================
-- 3. RLS POLICIES
-- =============================================

-- ai_memories
ALTER TABLE ai_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ai memories" ON ai_memories;
CREATE POLICY "Users can view own ai memories"
  ON ai_memories FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own ai memories" ON ai_memories;
CREATE POLICY "Users can insert own ai memories"
  ON ai_memories FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own ai memories" ON ai_memories;
CREATE POLICY "Users can update own ai memories"
  ON ai_memories FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own ai memories" ON ai_memories;
CREATE POLICY "Users can delete own ai memories"
  ON ai_memories FOR DELETE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage ai memories" ON ai_memories;
CREATE POLICY "Service role can manage ai memories"
  ON ai_memories FOR ALL TO service_role USING (true);

-- ai_memory_stats
ALTER TABLE ai_memory_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ai memory stats" ON ai_memory_stats;
CREATE POLICY "Users can view own ai memory stats"
  ON ai_memory_stats FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own ai memory stats" ON ai_memory_stats;
CREATE POLICY "Users can insert own ai memory stats"
  ON ai_memory_stats FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own ai memory stats" ON ai_memory_stats;
CREATE POLICY "Users can update own ai memory stats"
  ON ai_memory_stats FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage ai memory stats" ON ai_memory_stats;
CREATE POLICY "Service role can manage ai memory stats"
  ON ai_memory_stats FOR ALL TO service_role USING (true);

-- =============================================
-- 4. UPDATED_AT TRIGGER for ai_memories
-- =============================================
DROP TRIGGER IF EXISTS update_ai_memories_updated_at ON ai_memories;
CREATE TRIGGER update_ai_memories_updated_at
  BEFORE UPDATE ON ai_memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- 5. BACKFILL: Migrate existing style_summary into typed memories
-- One-time operation — existing summaries become 'preference'/'core_style' memories
-- with confidence 0.7 (will be refined on next reflection)
-- =============================================
INSERT INTO ai_memories (user_id, product_id, memory_type, category, content, confidence, source)
SELECT user_id, product_id, 'preference', 'core_style', style_summary, 0.7, 'backfill'
FROM product_ai_memory
WHERE style_summary IS NOT NULL AND style_summary != '';

INSERT INTO ai_memories (user_id, memory_type, category, content, confidence, source)
SELECT user_id, 'preference', 'core_style', style_summary, 0.7, 'backfill'
FROM user_ai_memory
WHERE style_summary IS NOT NULL AND style_summary != '';

-- =============================================
-- 6. BACKFILL: Seed ai_memory_stats from existing signal counters
-- =============================================
INSERT INTO ai_memory_stats (user_id, product_id, total_lifetime_signals, signals_since_last_reflection, last_reflection_at)
SELECT
  user_id,
  product_id,
  COALESCE((SELECT SUM(v::int) FROM jsonb_each_text(signals) AS t(k, v)), 0),
  signals_since_last_synthesis,
  last_synthesized_at
FROM product_ai_memory
ON CONFLICT (user_id, product_id) DO NOTHING;

-- Global stats from user_ai_memory
INSERT INTO ai_memory_stats (user_id, product_id, total_lifetime_signals, signals_since_last_reflection, last_reflection_at)
SELECT
  user_id,
  NULL,
  COALESCE((SELECT SUM(v::int) FROM jsonb_each_text(signals) AS t(k, v)), 0),
  signals_since_last_synthesis,
  last_synthesized_at
FROM user_ai_memory
ON CONFLICT (user_id, product_id) DO NOTHING;

-- =============================================
-- 7. RPC: Atomic increment for ai_memory_stats
-- Called from frontend recordAiSignal() and reflect-memory.ts
-- =============================================
CREATE OR REPLACE FUNCTION increment_ai_memory_stats(
  p_user_id UUID,
  p_product_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Security: use auth.uid() when called from client, fall back to param for service role
  v_user_id := COALESCE(auth.uid(), p_user_id);
  
  INSERT INTO ai_memory_stats (user_id, product_id, total_lifetime_signals, signals_since_last_reflection)
  VALUES (v_user_id, p_product_id, 1, 1)
  ON CONFLICT (user_id, product_id)
  DO UPDATE SET
    total_lifetime_signals = ai_memory_stats.total_lifetime_signals + 1,
    signals_since_last_reflection = ai_memory_stats.signals_since_last_reflection + 1;
END;
$$;

-- =============================================
-- WEBHOOK SETUP INSTRUCTIONS (manual in Supabase Dashboard):
-- 
-- 1. Go to Supabase Dashboard → Database → Webhooks → Create new
-- 2. Name: "ai-memory-reflect"
-- 3. Table: product_ai_memory
-- 4. Events: UPDATE
-- 5. URL: https://YOUR_DOMAIN/api/reflect-memory
-- 6. Headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
-- 7. Body: { "user_id": "{{user_id}}", "product_id": "{{product_id}}", "source": "webhook" }
--
-- This ensures reflection happens even if user closes their browser tab.
-- reflect-memory.ts has an early guard that skips if no new signals exist.
-- =============================================
