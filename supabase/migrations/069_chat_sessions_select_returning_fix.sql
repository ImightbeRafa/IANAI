-- Fix chat_sessions INSERT ... RETURNING under RLS.
-- can_read_chat_session() re-reads the row by id; during INSERT RETURNING that
-- lookup misses the new row, so PostgREST .insert().select() returned 403
-- even when INSERT WITH CHECK passed (brand create / new session broken).

DROP POLICY IF EXISTS "chat_sessions_select" ON public.chat_sessions;

CREATE POLICY "chat_sessions_select"
  ON public.chat_sessions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (business_id IS NOT NULL AND public.can_access_business(business_id))
    OR (product_id IS NOT NULL AND public.can_read_product(product_id))
    OR public.can_read_chat_session(id)
  );
