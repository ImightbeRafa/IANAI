-- =============================================
-- Context Documents Schema
-- Run this in your Supabase SQL Editor
-- Allows users to add documents, images, and links for script context
-- =============================================

-- Context Documents Table
CREATE TABLE IF NOT EXISTS context_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('pdf', 'image', 'link', 'text')),
  name TEXT NOT NULL,
  content TEXT,  -- For text type or extracted content
  url TEXT,      -- For links or Supabase Storage URLs
  file_path TEXT, -- Supabase Storage path
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE context_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own documents
CREATE POLICY "Users can view own context documents" ON context_documents
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "Users can create own context documents" ON context_documents
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can delete own context documents" ON context_documents
  FOR DELETE USING (owner_id = auth.uid());

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_context_documents_session ON context_documents(session_id);
CREATE INDEX IF NOT EXISTS idx_context_documents_owner ON context_documents(owner_id);

-- Storage bucket for context files (run this separately if needed)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('context-files', 'context-files', false);
