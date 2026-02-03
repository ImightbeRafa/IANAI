-- Migration: Add restaurant support
-- Adds restaurant-specific fields to the products table

-- Add restaurant fields to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS menu_text TEXT,
ADD COLUMN IF NOT EXISTS menu_pdf_url TEXT,
ADD COLUMN IF NOT EXISTS location TEXT,
ADD COLUMN IF NOT EXISTS schedule TEXT,
ADD COLUMN IF NOT EXISTS is_new_restaurant BOOLEAN DEFAULT true;

-- Update the type check constraint to include 'restaurant'
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_type_check;
ALTER TABLE products ADD CONSTRAINT products_type_check 
  CHECK (type IN ('product', 'service', 'restaurant'));

-- Create index for restaurant queries
CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
