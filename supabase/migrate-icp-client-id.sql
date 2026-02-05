-- =============================================
-- Migration: Add client_id to ICPs table
-- Run this in your Supabase SQL Editor
-- =============================================

-- Add client_id column (nullable for single accounts / backward compatibility)
ALTER TABLE icps ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE;

-- Index for faster lookups by client
CREATE INDEX IF NOT EXISTS idx_icps_client_id ON icps(client_id);
