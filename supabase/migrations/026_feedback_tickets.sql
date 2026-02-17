-- =============================================
-- Migration 026: Feedback tickets system
-- In-app user feedback with screenshots and metadata
-- =============================================

-- 1. Create feedback_tickets table
CREATE TABLE IF NOT EXISTS feedback_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_email TEXT,
  
  -- Ticket content
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'bug' CHECK (category IN ('bug', 'feature', 'question', 'other')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  
  -- Auto-captured context
  page_url TEXT,
  browser_info TEXT,
  screen_size TEXT,
  console_errors JSONB DEFAULT '[]'::jsonb,
  screenshot_url TEXT,
  
  -- Admin response
  admin_notes TEXT,
  resolved_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_user_id ON feedback_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_status ON feedback_tickets(status);
CREATE INDEX IF NOT EXISTS idx_feedback_tickets_created_at ON feedback_tickets(created_at DESC);

-- 3. RLS
ALTER TABLE feedback_tickets ENABLE ROW LEVEL SECURITY;

-- Users can create and view their own tickets
CREATE POLICY "Users can create own tickets"
ON feedback_tickets FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view own tickets"
ON feedback_tickets FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Admins can view and manage all tickets
CREATE POLICY "Admins can view all tickets"
ON feedback_tickets FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

CREATE POLICY "Admins can update all tickets"
ON feedback_tickets FOR UPDATE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

CREATE POLICY "Admins can delete tickets"
ON feedback_tickets FOR DELETE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
);

-- 4. Storage bucket for screenshots
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-screenshots', 'feedback-screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload screenshots
CREATE POLICY "Users can upload feedback screenshots"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'feedback-screenshots');

-- Allow public read access to screenshots (for admin viewing)
CREATE POLICY "Public can view feedback screenshots"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'feedback-screenshots');

-- 5. Updated_at trigger
CREATE TRIGGER update_feedback_tickets_updated_at
  BEFORE UPDATE ON feedback_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
