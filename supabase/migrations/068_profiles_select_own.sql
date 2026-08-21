-- =============================================
-- Migration 068: Own-row profiles SELECT/UPDATE
-- Additive. Safe for Preview now; safe for AIIAN after human review.
--
-- 061 dropped "profiles_select_authenticated" (global email dump).
-- Preview was left with RLS on and no SELECT policy, so authenticated
-- reads of profiles return []. That hides Admin and chat-shell invite
-- even when is_admin / chat_beta_access are true (service role still sees them).
-- Triggers from 061 / 067 still block clients from flipping is_admin
-- or chat_beta_access.
-- =============================================

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
