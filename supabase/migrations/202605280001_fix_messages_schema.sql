-- Migration: fix messages table schema to match frontend expectations
-- The frontend sends body, sender_name, read_by but the table only had content
-- Since this is pre-launch and content was never populated, this is safe.

-- 1. Add missing columns
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS sender_name text,
  ADD COLUMN IF NOT EXISTS read_by jsonb DEFAULT '[]'::jsonb;

-- 2. Drop the unused content column (frontend never sent it)
ALTER TABLE messages DROP COLUMN IF EXISTS content;

-- 3. Backfill read_by for any existing rows that have NULL
UPDATE messages SET read_by = '[]'::jsonb WHERE read_by IS NULL;

-- 4. Add index for fast conversation lookups
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
