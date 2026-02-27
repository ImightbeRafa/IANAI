-- Add rating column to posts table for AI memory learning
ALTER TABLE posts ADD COLUMN IF NOT EXISTS rating SMALLINT DEFAULT NULL;

-- Index for efficient querying of rated posts during memory reflection
CREATE INDEX IF NOT EXISTS idx_posts_rating_product ON posts (product_id, rating) WHERE rating IS NOT NULL;
