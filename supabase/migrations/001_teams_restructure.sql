-- =============================================
-- Database Schema for Teams & Single Users
-- =============================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. PROFILES TABLE (extends auth.users)
-- =============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  account_type TEXT NOT NULL DEFAULT 'single' CHECK (account_type IN ('single', 'team')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 2. TEAMS TABLE (for team accounts)
-- =============================================
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  max_members INTEGER DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 3. TEAM MEMBERS TABLE (users in a team)
-- =============================================
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  UNIQUE(team_id, user_id)
);

-- =============================================
-- 4. CLIENTS TABLE (for team accounts only)
-- =============================================
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 5. PRODUCTS TABLE (products/services)
-- =============================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- For single users: owner_id is set, client_id is NULL
  -- For teams: client_id is set, owner_id references who created it
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('product', 'service')),
  
  -- Core product info (from form questions)
  description TEXT,
  offer TEXT,
  awareness_level TEXT,
  market_alternatives TEXT,
  customer_values TEXT,
  purchase_reason TEXT,
  
  -- Additional context
  target_audience TEXT,
  unique_value TEXT,
  call_to_action TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure either owner_id OR client_id is set
  CONSTRAINT product_ownership CHECK (
    (owner_id IS NOT NULL AND client_id IS NULL) OR 
    (owner_id IS NOT NULL AND client_id IS NOT NULL)
  )
);

-- =============================================
-- 6. CHAT SESSIONS TABLE (conversations per product)
-- =============================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  title TEXT NOT NULL DEFAULT 'New Session',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  
  -- Session-specific context (extra info for this script generation)
  context TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 7. MESSAGES TABLE (chat messages)
-- =============================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 8. SCRIPTS TABLE (generated scripts)
-- =============================================
CREATE TABLE IF NOT EXISTS scripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  angle TEXT,
  is_favorite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;

-- PROFILES: Users can only read/update their own profile
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- TEAMS: Members can view, owners can update/delete
CREATE POLICY "Team members can view team" ON teams
  FOR SELECT USING (
    id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Owners can update team" ON teams
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Owners can delete team" ON teams
  FOR DELETE USING (owner_id = auth.uid());

CREATE POLICY "Users can create teams" ON teams
  FOR INSERT WITH CHECK (owner_id = auth.uid());

-- TEAM MEMBERS: Team members can view members, admins/owners can manage
CREATE POLICY "Team members can view members" ON team_members
  FOR SELECT USING (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can manage members" ON team_members
  FOR ALL USING (
    team_id IN (
      SELECT team_id FROM team_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- CLIENTS: Team members can view/manage clients
CREATE POLICY "Team members can view clients" ON clients
  FOR SELECT USING (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Team members can manage clients" ON clients
  FOR ALL USING (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- PRODUCTS: Owner or team member can access
CREATE POLICY "Users can view own products" ON products
  FOR SELECT USING (
    owner_id = auth.uid() OR
    client_id IN (
      SELECT c.id FROM clients c
      JOIN team_members tm ON c.team_id = tm.team_id
      WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own products" ON products
  FOR ALL USING (
    owner_id = auth.uid() OR
    client_id IN (
      SELECT c.id FROM clients c
      JOIN team_members tm ON c.team_id = tm.team_id
      WHERE tm.user_id = auth.uid()
    )
  );

-- CHAT SESSIONS: Access via product ownership
CREATE POLICY "Users can view own sessions" ON chat_sessions
  FOR SELECT USING (
    product_id IN (
      SELECT id FROM products WHERE 
        owner_id = auth.uid() OR
        client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Users can manage own sessions" ON chat_sessions
  FOR ALL USING (
    product_id IN (
      SELECT id FROM products WHERE 
        owner_id = auth.uid() OR
        client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
    )
  );

-- MESSAGES: Access via session
CREATE POLICY "Users can view session messages" ON messages
  FOR SELECT USING (
    session_id IN (
      SELECT cs.id FROM chat_sessions cs
      JOIN products p ON cs.product_id = p.id
      WHERE p.owner_id = auth.uid() OR
        p.client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Users can add messages" ON messages
  FOR INSERT WITH CHECK (
    session_id IN (
      SELECT cs.id FROM chat_sessions cs
      JOIN products p ON cs.product_id = p.id
      WHERE p.owner_id = auth.uid() OR
        p.client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
    )
  );

-- SCRIPTS: Access via product ownership
CREATE POLICY "Users can view own scripts" ON scripts
  FOR SELECT USING (
    product_id IN (
      SELECT id FROM products WHERE 
        owner_id = auth.uid() OR
        client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
    )
  );

CREATE POLICY "Users can manage own scripts" ON scripts
  FOR ALL USING (
    product_id IN (
      SELECT id FROM products WHERE 
        owner_id = auth.uid() OR
        client_id IN (
          SELECT c.id FROM clients c
          JOIN team_members tm ON c.team_id = tm.team_id
          WHERE tm.user_id = auth.uid()
        )
    )
  );

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-add owner as team member when team is created
CREATE OR REPLACE FUNCTION public.handle_new_team()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.team_members (team_id, user_id, role, joined_at)
  VALUES (NEW.id, NEW.owner_id, 'owner', NOW());
  
  -- Update profile to team account type
  UPDATE public.profiles SET account_type = 'team' WHERE id = NEW.owner_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_team_created ON teams;
CREATE TRIGGER on_team_created
  AFTER INSERT ON teams
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_team();

-- Update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_chat_sessions_updated_at BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_scripts_updated_at BEFORE UPDATE ON scripts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_team_id ON clients(team_id);
CREATE INDEX IF NOT EXISTS idx_products_owner_id ON products(owner_id);
CREATE INDEX IF NOT EXISTS idx_products_client_id ON products(client_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_product_id ON chat_sessions(product_id);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_scripts_product_id ON scripts(product_id);
CREATE INDEX IF NOT EXISTS idx_scripts_session_id ON scripts(session_id);
