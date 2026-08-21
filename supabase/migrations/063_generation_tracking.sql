-- =============================================
-- Migration 063: Generation correlation IDs
-- Links persisted posts to provider usage logs for exact admin cost/quality tracking.
-- Existing rows remain NULL and continue to work.
-- =============================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS generation_id UUID NULL;

ALTER TABLE api_usage_logs
  ADD COLUMN IF NOT EXISTS generation_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_posts_generation_id
  ON posts(generation_id)
  WHERE generation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_usage_logs_generation_id
  ON api_usage_logs(generation_id)
  WHERE generation_id IS NOT NULL;

COMMENT ON COLUMN posts.generation_id IS 'Client-generated UUID linking this post row to the API usage log for the generation request.';
COMMENT ON COLUMN api_usage_logs.generation_id IS 'Client-generated UUID used to correlate provider usage/cost with saved generated posts and ratings.';
