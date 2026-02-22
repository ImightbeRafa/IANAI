-- =============================================
-- Migration 040: Product Images
-- Persistent product images per product for reference in generation & enhancement
-- =============================================

CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_user ON product_images(user_id);

ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own product images" ON product_images
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own product images" ON product_images
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own product images" ON product_images
  FOR DELETE USING (user_id = auth.uid());

-- Also allow collaborators with editor role to view product images
CREATE POLICY "Collaborators can view product images" ON product_images
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM product_collaborators pc
      WHERE pc.product_id = product_images.product_id
        AND pc.user_id = auth.uid()
        AND pc.status = 'accepted'
    )
  );
