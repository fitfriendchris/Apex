-- Harden messages INSERT to prevent sender_email spoofing.
-- PostgreSQL does not allow comma-separated command lists in FOR clauses.
-- We create separate policies for SELECT / UPDATE / DELETE and a stricter INSERT.

DROP POLICY IF EXISTS "messages_participants" ON messages;

-- 1. SELECT: participants and coaches can read messages in their conversations
CREATE POLICY "messages_select" ON messages
  FOR SELECT USING (
    conversation_id LIKE (current_setting('request.jwt.claims', true)::json->>'email') || '%'
    OR conversation_id LIKE '%:' || (current_setting('request.jwt.claims', true)::json->>'email')
    OR EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'))
  );

-- 2. UPDATE: same scope as SELECT
CREATE POLICY "messages_update" ON messages
  FOR UPDATE USING (
    conversation_id LIKE (current_setting('request.jwt.claims', true)::json->>'email') || '%'
    OR conversation_id LIKE '%:' || (current_setting('request.jwt.claims', true)::json->>'email')
    OR EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'))
  );

-- 3. DELETE: same scope as SELECT
CREATE POLICY "messages_delete" ON messages
  FOR DELETE USING (
    conversation_id LIKE (current_setting('request.jwt.claims', true)::json->>'email') || '%'
    OR conversation_id LIKE '%:' || (current_setting('request.jwt.claims', true)::json->>'email')
    OR EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'))
  );

-- 4. INSERT: stricter — must be a participant AND sender must match JWT email (or be a coach)
CREATE POLICY "messages_insert" ON messages
  FOR INSERT WITH CHECK (
    (
      conversation_id LIKE (current_setting('request.jwt.claims', true)::json->>'email') || '%'
      OR conversation_id LIKE '%:' || (current_setting('request.jwt.claims', true)::json->>'email')
      OR EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'))
    )
    AND
    (
      sender_email = current_setting('request.jwt.claims', true)::json->>'email'
      OR EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'))
    )
  );
