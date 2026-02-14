-- Add context_links_content column to products table
-- Stores scraped text content from context links added during product creation
ALTER TABLE products ADD COLUMN IF NOT EXISTS context_links_content text DEFAULT '';
