-- =============================================
-- 057: Add ICP free-text description to businesses
-- Allows users to paste a detailed ideal customer profile
-- =============================================

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS icp_description TEXT;
