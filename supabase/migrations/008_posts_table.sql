-- =============================================
-- Migration: Posts Table for AI Image Generation
-- Stores generated Instagram post images
-- =============================================

-- Posts table for storing generated images
CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  
  -- Generation inputs
  prompt TEXT NOT NULL,
  input_images TEXT[], -- Array of base64 or URLs for reference images
  
  -- Generation result
  generated_image_url TEXT,
  flux_task_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'completed', 'failed')),
  
  -- Image settings
  width INTEGER DEFAULT 1080,
  height INTEGER DEFAULT 1080,
  output_format TEXT DEFAULT 'jpeg',
  
  -- Metadata
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_posts_product_id ON posts(product_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_by ON posts(created_by);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);

-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for posts
CREATE POLICY "Users can view own posts" ON posts
  FOR SELECT USING (
    product_id IN (
      SELECT id FROM products WHERE 
        owner_id = auth.uid() OR
        client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Users can manage own posts" ON posts
  FOR ALL USING (
    product_id IN (
      SELECT id FROM products WHERE 
        owner_id = auth.uid() OR
        client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
    )
  );

-- Update timestamp trigger
CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
