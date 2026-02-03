-- Migration: Add new form fields for products and services
-- Updates the products table with new question-based fields

-- Add new form fields to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS product_description TEXT,
ADD COLUMN IF NOT EXISTS main_problem TEXT,
ADD COLUMN IF NOT EXISTS best_customers TEXT,
ADD COLUMN IF NOT EXISTS failed_attempts TEXT,
ADD COLUMN IF NOT EXISTS attention_grabber TEXT,
ADD COLUMN IF NOT EXISTS real_pain TEXT,
ADD COLUMN IF NOT EXISTS pain_consequences TEXT,
ADD COLUMN IF NOT EXISTS expected_result TEXT,
ADD COLUMN IF NOT EXISTS differentiation TEXT,
ADD COLUMN IF NOT EXISTS key_objection TEXT,
ADD COLUMN IF NOT EXISTS shipping_info TEXT;

-- Create index for faster queries on product type
CREATE INDEX IF NOT EXISTS idx_products_owner_type ON products(owner_id, type);
