-- =============================================
-- Migration 060: Product Image Kind
-- Distinguish between product reference images (exact truth, must not be altered)
-- and context/inspiration images (mood, audience, scene, lifestyle).
-- =============================================

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'product'
  CHECK (kind IN ('product', 'context'));

CREATE INDEX IF NOT EXISTS idx_product_images_product_kind
  ON product_images(product_id, kind);
