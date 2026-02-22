-- Per-user aggregated usage stats for admin dashboard
-- Returns one row per user with breakdown by feature

CREATE OR REPLACE FUNCTION get_user_usage_stats(
  start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  end_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  user_id UUID,
  user_email TEXT,
  total_calls BIGINT,
  total_cost_usd DECIMAL,
  script_calls BIGINT,
  description_calls BIGINT,
  image_calls BIGINT,
  video_calls BIGINT,
  voice_calls BIGINT,
  other_calls BIGINT,
  last_active TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.user_id,
    l.user_email,
    COUNT(*)::BIGINT as total_calls,
    COALESCE(SUM(l.estimated_cost_usd), 0)::DECIMAL as total_cost_usd,
    COUNT(*) FILTER (WHERE l.feature = 'script')::BIGINT as script_calls,
    COUNT(*) FILTER (WHERE l.feature = 'description')::BIGINT as description_calls,
    COUNT(*) FILTER (WHERE l.feature IN ('image', 'edit', 'enhance'))::BIGINT as image_calls,
    COUNT(*) FILTER (WHERE l.feature IN ('video', 'kling_video'))::BIGINT as video_calls,
    COUNT(*) FILTER (WHERE l.feature = 'voice_transcription')::BIGINT as voice_calls,
    COUNT(*) FILTER (WHERE l.feature NOT IN ('script', 'description', 'image', 'edit', 'enhance', 'video', 'kling_video', 'voice_transcription'))::BIGINT as other_calls,
    MAX(l.created_at) as last_active
  FROM api_usage_logs l
  WHERE l.created_at BETWEEN start_date AND end_date
    AND l.success = true
  GROUP BY l.user_id, l.user_email
  ORDER BY total_cost_usd DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add index on user_email for text search (ilike) on logs
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_user_email ON api_usage_logs(user_email);
