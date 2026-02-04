-- Migration: Videos table and usage tracking updates
-- Adds support for B-Roll video generation and video usage tracking

-- Create videos table for B-Roll storage
CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  input_image_url TEXT,
  generated_video_url TEXT,
  request_id TEXT,
  status TEXT DEFAULT 'generating' CHECK (status IN ('pending', 'generating', 'completed', 'failed')),
  duration INTEGER DEFAULT 5,
  aspect_ratio TEXT DEFAULT '16:9',
  resolution TEXT DEFAULT '720p',
  model TEXT DEFAULT 'grok-imagine-video',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for videos table
CREATE INDEX IF NOT EXISTS idx_videos_product_id ON videos(product_id);
CREATE INDEX IF NOT EXISTS idx_videos_created_by ON videos(created_by);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

-- Add videos_generated column to usage table if it doesn't exist
ALTER TABLE usage ADD COLUMN IF NOT EXISTS videos_generated INTEGER DEFAULT 0;

-- Add videos_per_month column to plan_limits table if it doesn't exist
ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS videos_per_month INTEGER DEFAULT 10;

-- Update plan limits to include video limits
UPDATE plan_limits SET videos_per_month = 5 WHERE plan = 'free';
UPDATE plan_limits SET videos_per_month = 25 WHERE plan = 'starter';
UPDATE plan_limits SET videos_per_month = 100 WHERE plan = 'professional';
UPDATE plan_limits SET videos_per_month = -1 WHERE plan = 'enterprise'; -- unlimited

-- Enable RLS on videos table
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

-- RLS policies for videos
CREATE POLICY "Users can view own videos"
ON videos FOR SELECT
TO authenticated
USING (created_by = auth.uid());

CREATE POLICY "Users can insert own videos"
ON videos FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own videos"
ON videos FOR UPDATE
TO authenticated
USING (created_by = auth.uid());

CREATE POLICY "Users can delete own videos"
ON videos FOR DELETE
TO authenticated
USING (created_by = auth.uid());

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_videos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW
  EXECUTE FUNCTION update_videos_updated_at();
