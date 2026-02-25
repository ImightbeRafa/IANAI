-- =============================================
-- Migration 052: Brand Kit V3 — Multi-Kit Support
-- - Drop UNIQUE(user_id) to allow multiple kits
-- - Add is_default, client_id columns
-- - Add set_default_brand_kit RPC
-- - Add brand_kits limit to plan_limits
-- - Add default_brand_kit_id to clients table
-- =============================================

-- =============================================
-- 1. DROP UNIQUE CONSTRAINT (allow multiple kits per user)
-- =============================================
ALTER TABLE brand_kits DROP CONSTRAINT IF EXISTS brand_kits_user_id_key;

-- =============================================
-- 2. ADD NEW COLUMNS
-- =============================================
ALTER TABLE brand_kits
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

-- =============================================
-- 3. MIGRATE EXISTING DATA — mark existing kits as default
-- =============================================
UPDATE brand_kits SET is_default = true WHERE is_active = true;

-- =============================================
-- 4. ADD INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_brand_kits_user_default ON brand_kits(user_id, is_default);
CREATE INDEX IF NOT EXISTS idx_brand_kits_client ON brand_kits(client_id) WHERE client_id IS NOT NULL;

-- =============================================
-- 5. RPC: set_default_brand_kit
-- =============================================
CREATE OR REPLACE FUNCTION set_default_brand_kit(p_user_id UUID, p_kit_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Unset all defaults for this user
  UPDATE brand_kits SET is_default = false WHERE user_id = p_user_id;
  -- Set the chosen kit as default
  UPDATE brand_kits SET is_default = true WHERE id = p_kit_id AND user_id = p_user_id;
END;
$$;

-- =============================================
-- 6. PLAN LIMITS — brand_kits_max column
-- =============================================
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS brand_kits_max INTEGER NOT NULL DEFAULT 1;

UPDATE plan_limits SET brand_kits_max = 1 WHERE plan = 'free';
UPDATE plan_limits SET brand_kits_max = 1 WHERE plan = 'starter';
UPDATE plan_limits SET brand_kits_max = 5 WHERE plan = 'pro';
UPDATE plan_limits SET brand_kits_max = 5 WHERE plan = 'meta_advanze';
UPDATE plan_limits SET brand_kits_max = 999 WHERE plan = 'enterprise';

-- =============================================
-- 7. CLIENT-KIT ASSOCIATION
-- =============================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_brand_kit_id UUID REFERENCES brand_kits(id) ON DELETE SET NULL;

-- =============================================
-- 8. UPDATE RLS POLICIES for multi-kit access
-- =============================================
-- Drop old policies (they still work but let's ensure clarity)
DROP POLICY IF EXISTS "Users can view own brand kit" ON brand_kits;
DROP POLICY IF EXISTS "Users can create own brand kit" ON brand_kits;
DROP POLICY IF EXISTS "Users can update own brand kit" ON brand_kits;
DROP POLICY IF EXISTS "Users can delete own brand kit" ON brand_kits;

-- Recreate with same logic (unchanged, user_id = auth.uid())
CREATE POLICY "Users can view own brand kits" ON brand_kits
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create own brand kits" ON brand_kits
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own brand kits" ON brand_kits
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own brand kits" ON brand_kits
  FOR DELETE USING (user_id = auth.uid());
