-- =============================================
-- Migration 062: Carousel post support
-- Adds grouping columns so a set of N generated images can be linked as one carousel.
-- Slides are regular rows in `posts`; they share a `carousel_group_id` and are ordered
-- by `slide_index` (1..N). `carousel_subtype` records the structural template used
-- (educational-list / how-to-steps / before-after / myth-vs-fact).
-- =============================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS carousel_group_id UUID NULL,
  ADD COLUMN IF NOT EXISTS slide_index INTEGER NULL,
  ADD COLUMN IF NOT EXISTS slide_total INTEGER NULL,
  ADD COLUMN IF NOT EXISTS carousel_subtype TEXT NULL;

-- Validation: slide_index must be positive and bounded by slide_total.
ALTER TABLE posts
  DROP CONSTRAINT IF EXISTS posts_slide_index_check;
ALTER TABLE posts
  ADD CONSTRAINT posts_slide_index_check
    CHECK (
      (slide_index IS NULL AND carousel_group_id IS NULL)
      OR (slide_index IS NOT NULL AND carousel_group_id IS NOT NULL AND slide_index >= 1 AND slide_index <= COALESCE(slide_total, 10))
    );

-- Index for grouping posts into carousels on the read path (e.g., when listing product posts).
CREATE INDEX IF NOT EXISTS idx_posts_carousel_group_id
  ON posts(carousel_group_id, slide_index)
  WHERE carousel_group_id IS NOT NULL;

COMMENT ON COLUMN posts.carousel_group_id IS 'Groups multiple posts rows into one carousel. NULL = standalone post.';
COMMENT ON COLUMN posts.slide_index IS '1-based position of this slide within the carousel. NULL for standalone posts.';
COMMENT ON COLUMN posts.slide_total IS 'Total slides in the carousel this row belongs to. NULL for standalone posts.';
COMMENT ON COLUMN posts.carousel_subtype IS 'Structural template used (e.g. educational-list, how-to-steps, before-after, myth-vs-fact).';
