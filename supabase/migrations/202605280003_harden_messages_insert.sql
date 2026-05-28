-- Harden messages INSERT to prevent sender_email spoofing.
-- The existing FOR ALL policy allowed any participant to INSERT with any sender_email.
-- We split it into SELECT/UPDATE/DELETE (conversation-based) and INSERT (conversation + sender verified).

DROP POLICY IF EXISTS "messages_participants" ON messages;

-- Participants and coaches can read, update, delete messages in their conversations
CREATE POLICY "messages_participants" ON messages
  FOR SELECT, UPDATE, DELETE USING (
    conversation_id LIKE (current_setting('request.jwt.claims', true)::json->>'email') || '%'
    OR conversation_id LIKE '%:' || (current_setting('request.jwt.claims', true)::json->>'email')
    OR EXISTS (SELECT 1 FROM coaches WHERE LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email'))
  );

-- Only the authenticated sender (or a coach) can insert a message into a conversation they participate in
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
