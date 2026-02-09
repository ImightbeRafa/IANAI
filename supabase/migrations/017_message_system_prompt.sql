-- Add system_prompt column to messages table
-- Stores the full master prompt used for each AI generation
ALTER TABLE messages ADD COLUMN IF NOT EXISTS system_prompt text;
