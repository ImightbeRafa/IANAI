-- =============================================
-- ICP (Ideal Client Profile) Schema
-- Run this in your Supabase SQL Editor
-- =============================================

-- ICP Table
CREATE TABLE IF NOT EXISTS icps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,  -- Persona que [situación], quiere [resultado], pero bloqueada por [bloqueo]
  awareness_level TEXT NOT NULL CHECK (awareness_level IN ('unaware', 'problem_aware', 'solution_aware', 'product_aware')),
  sophistication_level TEXT NOT NULL CHECK (sophistication_level IN ('low', 'medium', 'high')),
  urgency_type TEXT NOT NULL CHECK (urgency_type IN ('immediate', 'latent', 'low')),
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'any')),
  age_range TEXT NOT NULL CHECK (age_range IN ('18-24', '25-34', '35-44', '45-54', '55+')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE icps ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own ICPs
CREATE POLICY "Users can view own ICPs" ON icps
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "Users can create own ICPs" ON icps
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update own ICPs" ON icps
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Users can delete own ICPs" ON icps
  FOR DELETE USING (owner_id = auth.uid());

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_icps_owner_id ON icps(owner_id);
CREATE INDEX IF NOT EXISTS idx_icps_client_id ON icps(client_id);
