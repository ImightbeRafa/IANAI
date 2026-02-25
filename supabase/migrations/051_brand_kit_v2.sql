-- =============================================
-- Migration 051: Brand Kit v2
-- Adds font, tagline, industry, target audience,
-- AI-extracted visual style notes, reference images.
-- Changes is_active default to false (must opt-in).
-- =============================================

-- New columns
ALTER TABLE brand_kits
  ADD COLUMN IF NOT EXISTS font_primary TEXT,
  ADD COLUMN IF NOT EXISTS font_secondary TEXT,
  ADD COLUMN IF NOT EXISTS tagline TEXT,
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS target_audience TEXT,
  ADD COLUMN IF NOT EXISTS visual_style_notes TEXT,
  ADD COLUMN IF NOT EXISTS reference_images TEXT[] DEFAULT '{}';

-- Change default for is_active to false (new kits start disabled)
ALTER TABLE brand_kits ALTER COLUMN is_active SET DEFAULT false;

-- Storage bucket for brand kit reference images (logos + style refs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: users can upload/read/delete their own files
-- Files stored under: brand-assets/{user_id}/...
CREATE POLICY "Users can upload brand assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'brand-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can view own brand assets"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'brand-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Brand assets are publicly readable"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'brand-assets');

CREATE POLICY "Users can delete own brand assets"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'brand-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
