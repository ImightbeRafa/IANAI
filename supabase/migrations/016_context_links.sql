-- Add context_links column to products table
-- Stores reference URLs added during product creation
ALTER TABLE products ADD COLUMN IF NOT EXISTS context_links text[] DEFAULT '{}';
