-- API Usage Logs for Admin Dashboard
-- Tracks all AI API calls with model, cost, and metadata

CREATE TABLE IF NOT EXISTS api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  feature TEXT NOT NULL, -- 'script', 'image', 'paste_organize'
  model TEXT NOT NULL, -- 'grok', 'gemini', 'flux', 'nano-banana', 'nano-banana-pro'
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  estimated_cost_usd DECIMAL(10, 6) DEFAULT 0,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient querying
CREATE INDEX idx_api_usage_logs_created_at ON api_usage_logs(created_at DESC);
CREATE INDEX idx_api_usage_logs_model ON api_usage_logs(model);
CREATE INDEX idx_api_usage_logs_feature ON api_usage_logs(feature);
CREATE INDEX idx_api_usage_logs_user_id ON api_usage_logs(user_id);

-- Function to get usage summary by model
CREATE OR REPLACE FUNCTION get_usage_summary(
  start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  end_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  model TEXT,
  feature TEXT,
  total_calls BIGINT,
  successful_calls BIGINT,
  failed_calls BIGINT,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
  total_tokens BIGINT,
  total_cost_usd DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    l.model,
    l.feature,
    COUNT(*)::BIGINT as total_calls,
    COUNT(*) FILTER (WHERE l.success)::BIGINT as successful_calls,
    COUNT(*) FILTER (WHERE NOT l.success)::BIGINT as failed_calls,
    COALESCE(SUM(l.input_tokens), 0)::BIGINT as total_input_tokens,
    COALESCE(SUM(l.output_tokens), 0)::BIGINT as total_output_tokens,
    COALESCE(SUM(l.total_tokens), 0)::BIGINT as total_tokens,
    COALESCE(SUM(l.estimated_cost_usd), 0)::DECIMAL as total_cost_usd
  FROM api_usage_logs l
  WHERE l.created_at BETWEEN start_date AND end_date
  GROUP BY l.model, l.feature
  ORDER BY total_cost_usd DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get daily usage
CREATE OR REPLACE FUNCTION get_daily_usage(
  start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '30 days',
  end_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  day DATE,
  model TEXT,
  total_calls BIGINT,
  total_cost_usd DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE(l.created_at) as day,
    l.model,
    COUNT(*)::BIGINT as total_calls,
    COALESCE(SUM(l.estimated_cost_usd), 0)::DECIMAL as total_cost_usd
  FROM api_usage_logs l
  WHERE l.created_at BETWEEN start_date AND end_date
  GROUP BY DATE(l.created_at), l.model
  ORDER BY day DESC, l.model;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS - Only admins can read logs
ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role to insert (from API)
CREATE POLICY "Service role can insert logs"
  ON api_usage_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow admins to read (check by email)
CREATE POLICY "Admin can read logs"
  ON api_usage_logs FOR SELECT
  USING (
    auth.jwt() ->> 'email' IN ('ralauas@gmail.com', 'admin@advanceai.studio')
  );
