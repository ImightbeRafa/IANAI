-- =============================================
-- Migration 028: Product Collaborators (Sharing)
-- Share specific products with other users by email.
-- Collaborators ONLY see the shared product's scripts and posts.
-- They have ZERO access to the owner's other data.
-- =============================================

-- 1. Create product_collaborators table
CREATE TABLE IF NOT EXISTS product_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,       -- NULL if invited user hasn't signed up yet
  invited_email TEXT NOT NULL,                                    -- Email used for the invite
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  invited_by UUID NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  UNIQUE(product_id, invited_email)
);

-- Indexes
CREATE INDEX idx_product_collaborators_product ON product_collaborators(product_id);
CREATE INDEX idx_product_collaborators_user ON product_collaborators(user_id);
CREATE INDEX idx_product_collaborators_email ON product_collaborators(invited_email);

-- RLS on product_collaborators
ALTER TABLE product_collaborators ENABLE ROW LEVEL SECURITY;

-- Product owner can manage collaborators
CREATE POLICY "Owner can manage collaborators"
  ON product_collaborators FOR ALL
  USING (
    product_id IN (SELECT id FROM products WHERE owner_id = auth.uid())
  );

-- Collaborators can view their own invites
CREATE POLICY "Collaborators can view own invites"
  ON product_collaborators FOR SELECT
  USING (user_id = auth.uid() OR invited_email = (SELECT email FROM profiles WHERE id = auth.uid()));

-- Service role can manage (for API)
CREATE POLICY "Service role full access collaborators"
  ON product_collaborators FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================
-- 2. Update RLS policies to include collaborator access
-- Helper: a reusable check for "is this user a collaborator on this product?"
-- =============================================

-- Helper function: check if user has collaborator access to a product
CREATE OR REPLACE FUNCTION user_has_product_access(p_product_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM products WHERE id = p_product_id AND owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM product_collaborators
    WHERE product_id = p_product_id
      AND (user_id = auth.uid() OR invited_email = (SELECT email FROM profiles WHERE id = auth.uid()))
      AND status = 'accepted'
  ) OR EXISTS (
    SELECT 1 FROM products p
    JOIN clients c ON p.client_id = c.id
    JOIN team_members tm ON c.team_id = tm.team_id
    WHERE p.id = p_product_id AND tm.user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- =============================================
-- PRODUCTS: Drop old + create new policies
-- =============================================
DROP POLICY IF EXISTS "Users can view own products" ON products;
DROP POLICY IF EXISTS "Users can manage own products" ON products;

CREATE POLICY "Users can view own products" ON products
  FOR SELECT USING (
    owner_id = auth.uid()
    OR client_id IN (
      SELECT c.id FROM clients c
      JOIN team_members tm ON c.team_id = tm.team_id
      WHERE tm.user_id = auth.uid()
    )
    OR id IN (
      SELECT product_id FROM product_collaborators
      WHERE (user_id = auth.uid() OR invited_email = (SELECT email FROM profiles WHERE id = auth.uid()))
        AND status = 'accepted'
    )
  );

-- Manage (insert/update/delete) stays owner-only + team
CREATE POLICY "Users can manage own products" ON products
  FOR ALL USING (
    owner_id = auth.uid()
    OR client_id IN (
      SELECT c.id FROM clients c
      JOIN team_members tm ON c.team_id = tm.team_id
      WHERE tm.user_id = auth.uid()
    )
  );

-- =============================================
-- POSTS: Drop old + create new policies
-- =============================================
DROP POLICY IF EXISTS "Users can view own posts" ON posts;
DROP POLICY IF EXISTS "Users can manage own posts" ON posts;

CREATE POLICY "Users can view own posts" ON posts
  FOR SELECT USING (
    product_id IN (
      SELECT id FROM products WHERE
        owner_id = auth.uid()
        OR client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
        OR id IN (
          SELECT product_id FROM product_collaborators
          WHERE (user_id = auth.uid() OR invited_email = (SELECT email FROM profiles WHERE id = auth.uid()))
            AND status = 'accepted'
        )
    )
  );

-- Editors can insert posts on shared products; owner/team can do everything
CREATE POLICY "Users can manage own posts" ON posts
  FOR ALL USING (
    product_id IN (
      SELECT id FROM products WHERE
        owner_id = auth.uid()
        OR client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
        OR id IN (
          SELECT product_id FROM product_collaborators
          WHERE (user_id = auth.uid() OR invited_email = (SELECT email FROM profiles WHERE id = auth.uid()))
            AND status = 'accepted'
            AND role = 'editor'
        )
    )
  );

-- =============================================
-- CHAT SESSIONS: Drop old + create new policies
-- =============================================
DROP POLICY IF EXISTS "Users can view own sessions" ON chat_sessions;
DROP POLICY IF EXISTS "Users can manage own sessions" ON chat_sessions;

CREATE POLICY "Users can view own sessions" ON chat_sessions
  FOR SELECT USING (
    product_id IN (
      SELECT id FROM products WHERE
        owner_id = auth.uid()
        OR client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
        OR id IN (
          SELECT product_id FROM product_collaborators
          WHERE (user_id = auth.uid() OR invited_email = (SELECT email FROM profiles WHERE id = auth.uid()))
            AND status = 'accepted'
        )
    )
  );

CREATE POLICY "Users can manage own sessions" ON chat_sessions
  FOR ALL USING (
    product_id IN (
      SELECT id FROM products WHERE
        owner_id = auth.uid()
        OR client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
        OR id IN (
          SELECT product_id FROM product_collaborators
          WHERE (user_id = auth.uid() OR invited_email = (SELECT email FROM profiles WHERE id = auth.uid()))
            AND status = 'accepted'
            AND role = 'editor'
        )
    )
  );

-- =============================================
-- MESSAGES: Drop old + create new policies
-- =============================================
DROP POLICY IF EXISTS "Users can view session messages" ON messages;
DROP POLICY IF EXISTS "Users can add messages" ON messages;

CREATE POLICY "Users can view session messages" ON messages
  FOR SELECT USING (
    session_id IN (
      SELECT cs.id FROM chat_sessions cs
      WHERE cs.product_id IN (
        SELECT id FROM products WHERE
          owner_id = auth.uid()
          OR client_id IN (
            SELECT c.id FROM clients c
            JOIN team_members tm ON c.team_id = tm.team_id
            WHERE tm.user_id = auth.uid()
          )
          OR id IN (
            SELECT product_id FROM product_collaborators
            WHERE (user_id = auth.uid() OR invited_email = (SELECT email FROM profiles WHERE id = auth.uid()))
              AND status = 'accepted'
          )
      )
    )
  );

CREATE POLICY "Users can add messages" ON messages
  FOR INSERT WITH CHECK (
    session_id IN (
      SELECT cs.id FROM chat_sessions cs
      WHERE cs.product_id IN (
        SELECT id FROM products WHERE
          owner_id = auth.uid()
          OR client_id IN (
            SELECT c.id FROM clients c
            JOIN team_members tm ON c.team_id = tm.team_id
            WHERE tm.user_id = auth.uid()
          )
          OR id IN (
            SELECT product_id FROM product_collaborators
            WHERE (user_id = auth.uid() OR invited_email = (SELECT email FROM profiles WHERE id = auth.uid()))
              AND status = 'accepted'
              AND role = 'editor'
          )
      )
    )
  );

-- =============================================
-- SCRIPTS: Drop old + create new policies
-- =============================================
DROP POLICY IF EXISTS "Users can view own scripts" ON scripts;
DROP POLICY IF EXISTS "Users can manage own scripts" ON scripts;

CREATE POLICY "Users can view own scripts" ON scripts
  FOR SELECT USING (
    product_id IN (
      SELECT id FROM products WHERE
        owner_id = auth.uid()
        OR client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
        OR id IN (
          SELECT product_id FROM product_collaborators
          WHERE (user_id = auth.uid() OR invited_email = (SELECT email FROM profiles WHERE id = auth.uid()))
            AND status = 'accepted'
        )
    )
  );

CREATE POLICY "Users can manage own scripts" ON scripts
  FOR ALL USING (
    product_id IN (
      SELECT id FROM products WHERE
        owner_id = auth.uid()
        OR client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
        OR id IN (
          SELECT product_id FROM product_collaborators
          WHERE (user_id = auth.uid() OR invited_email = (SELECT email FROM profiles WHERE id = auth.uid()))
            AND status = 'accepted'
            AND role = 'editor'
        )
    )
  );

-- =============================================
-- 3. Auto-accept pending invites when a user signs up
-- Updates product_collaborators.user_id and status when a new profile is created
-- =============================================
CREATE OR REPLACE FUNCTION accept_pending_invites()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE product_collaborators
  SET user_id = NEW.id, status = 'accepted', accepted_at = NOW()
  WHERE invited_email = NEW.email AND status = 'pending' AND user_id IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_profile_created_accept_invites
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION accept_pending_invites();
