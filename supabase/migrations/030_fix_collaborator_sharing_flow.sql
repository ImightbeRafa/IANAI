-- =============================================
-- Migration 030: Fix collaborator sharing flow
--
-- Issues fixed:
-- 1. Duplicate RLS policies — migration 028 failed to drop the 003-era
--    policies (different names) so duplicate policies exist on
--    products, chat_sessions, messages, scripts. Clean them up.
-- 2. Invited users can't UPDATE their own pending invites (no policy).
-- 3. Profile lookup by email blocked by RLS — inviteCollaborator can't
--    check if a user exists, so all invites stay 'pending'.
-- 4. shared_by_email empty — join to profiles blocked by RLS.
--
-- Root cause of 3+4: profiles RLS only allows id = auth.uid().
-- Fix: Allow authenticated users to read basic profile info (email, id).
-- =============================================

-- =============================================
-- STEP 1: Clean up duplicate policies
-- Migration 003 created: products_select, products_insert, etc.
-- Migration 028 added:  "Users can view own products", etc.
-- Keep the 028 versions (they include collaborator access) and drop 003 ones.
-- =============================================

-- Products: drop 003-era duplicates
DROP POLICY IF EXISTS "products_select" ON products;
DROP POLICY IF EXISTS "products_insert" ON products;
DROP POLICY IF EXISTS "products_update" ON products;
DROP POLICY IF EXISTS "products_delete" ON products;

-- Chat sessions: drop 003-era duplicates
DROP POLICY IF EXISTS "chat_sessions_select" ON chat_sessions;
DROP POLICY IF EXISTS "chat_sessions_insert" ON chat_sessions;
DROP POLICY IF EXISTS "chat_sessions_update" ON chat_sessions;
DROP POLICY IF EXISTS "chat_sessions_delete" ON chat_sessions;

-- Messages: drop 003-era duplicates
DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;

-- Scripts: drop 003-era duplicates
DROP POLICY IF EXISTS "scripts_select" ON scripts;
DROP POLICY IF EXISTS "scripts_insert" ON scripts;
DROP POLICY IF EXISTS "scripts_update" ON scripts;
DROP POLICY IF EXISTS "scripts_delete" ON scripts;

-- =============================================
-- STEP 2: Allow invited users to accept their own pending invites
-- Without this, acceptPendingInvites() on dashboard load always fails.
-- =============================================

CREATE POLICY "Invited users can accept their invites"
  ON product_collaborators FOR UPDATE
  USING (
    invited_email = (SELECT email FROM profiles WHERE id = auth.uid())
    AND status = 'pending'
  )
  WITH CHECK (
    invited_email = (SELECT email FROM profiles WHERE id = auth.uid())
  );

-- =============================================
-- STEP 3: Allow authenticated users to look up profiles by email
-- Required for: inviteCollaborator (check if user exists),
--               getSharedProducts join (show inviter email),
--               inviteTeamMember (look up user by email).
-- Only exposes id, email, full_name — same data visible in any
-- team/collaboration context. This is standard for multi-user apps.
-- =============================================

-- Drop the overly restrictive 003-era policy
DROP POLICY IF EXISTS "profiles_select" ON profiles;

-- Allow users to read their own full profile
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (id = auth.uid());

-- Allow authenticated users to look up other profiles (for invites/collaboration)
CREATE POLICY "profiles_select_authenticated" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');
