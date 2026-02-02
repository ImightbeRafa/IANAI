-- =============================================
-- FULL DATABASE RESET AND SETUP
-- Run this ONCE in Supabase SQL Editor
-- =============================================

-- STEP 1: Drop functions CASCADE (this also drops their triggers)
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_team() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;

-- STEP 2: Drop all tables CASCADE
DROP TABLE IF EXISTS scripts CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS chat_sessions CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS team_members CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- =============================================
-- NOW CREATE EVERYTHING FRESH
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROFILES
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  account_type TEXT NOT NULL DEFAULT 'team' CHECK (account_type IN ('single', 'team')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TEAMS
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  max_members INTEGER DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TEAM MEMBERS
CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  invited_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  UNIQUE(team_id, user_id)
);

-- 4. CLIENTS
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. PRODUCTS
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('product', 'service')),
  description TEXT,
  offer TEXT,
  awareness_level TEXT,
  market_alternatives TEXT,
  customer_values TEXT,
  purchase_reason TEXT,
  target_audience TEXT,
  unique_value TEXT,
  call_to_action TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT product_ownership CHECK (
    (owner_id IS NOT NULL AND client_id IS NULL) OR 
    (owner_id IS NOT NULL AND client_id IS NOT NULL)
  )
);

-- 6. CHAT SESSIONS
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  title TEXT NOT NULL DEFAULT 'New Session',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  context TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. MESSAGES
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. SCRIPTS
CREATE TABLE scripts (
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
-- ROW LEVEL SECURITY
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- TEAMS
CREATE POLICY "Team members can view team" ON teams FOR SELECT USING (id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
CREATE POLICY "Owners can update team" ON teams FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "Owners can delete team" ON teams FOR DELETE USING (owner_id = auth.uid());
CREATE POLICY "Users can create teams" ON teams FOR INSERT WITH CHECK (owner_id = auth.uid());

-- TEAM MEMBERS
CREATE POLICY "Team members can view members" ON team_members FOR SELECT USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
CREATE POLICY "Admins can manage members" ON team_members FOR ALL USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

-- CLIENTS
CREATE POLICY "Team members can view clients" ON clients FOR SELECT USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
CREATE POLICY "Team members can manage clients" ON clients FOR ALL USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));

-- PRODUCTS
CREATE POLICY "Users can view own products" ON products FOR SELECT USING (owner_id = auth.uid() OR client_id IN (SELECT c.id FROM clients c JOIN team_members tm ON c.team_id = tm.team_id WHERE tm.user_id = auth.uid()));
CREATE POLICY "Users can manage own products" ON products FOR ALL USING (owner_id = auth.uid() OR client_id IN (SELECT c.id FROM clients c JOIN team_members tm ON c.team_id = tm.team_id WHERE tm.user_id = auth.uid()));

-- CHAT SESSIONS
CREATE POLICY "Users can view own sessions" ON chat_sessions FOR SELECT USING (product_id IN (SELECT id FROM products WHERE owner_id = auth.uid() OR client_id IN (SELECT c.id FROM clients c JOIN team_members tm ON c.team_id = tm.team_id WHERE tm.user_id = auth.uid())));
CREATE POLICY "Users can manage own sessions" ON chat_sessions FOR ALL USING (product_id IN (SELECT id FROM products WHERE owner_id = auth.uid() OR client_id IN (SELECT c.id FROM clients c JOIN team_members tm ON c.team_id = tm.team_id WHERE tm.user_id = auth.uid())));

-- MESSAGES
CREATE POLICY "Users can view session messages" ON messages FOR SELECT USING (session_id IN (SELECT cs.id FROM chat_sessions cs JOIN products p ON cs.product_id = p.id WHERE p.owner_id = auth.uid() OR p.client_id IN (SELECT c.id FROM clients c JOIN team_members tm ON c.team_id = tm.team_id WHERE tm.user_id = auth.uid())));
CREATE POLICY "Users can add messages" ON messages FOR INSERT WITH CHECK (session_id IN (SELECT cs.id FROM chat_sessions cs JOIN products p ON cs.product_id = p.id WHERE p.owner_id = auth.uid() OR p.client_id IN (SELECT c.id FROM clients c JOIN team_members tm ON c.team_id = tm.team_id WHERE tm.user_id = auth.uid())));

-- SCRIPTS
CREATE POLICY "Users can view own scripts" ON scripts FOR SELECT USING (product_id IN (SELECT id FROM products WHERE owner_id = auth.uid() OR client_id IN (SELECT c.id FROM clients c JOIN team_members tm ON c.team_id = tm.team_id WHERE tm.user_id = auth.uid())));
CREATE POLICY "Users can manage own scripts" ON scripts FOR ALL USING (product_id IN (SELECT id FROM products WHERE owner_id = auth.uid() OR client_id IN (SELECT c.id FROM clients c JOIN team_members tm ON c.team_id = tm.team_id WHERE tm.user_id = auth.uid())));

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, account_type)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', 'team');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-add owner as team member when team is created
CREATE OR REPLACE FUNCTION public.handle_new_team()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.team_members (team_id, user_id, role, joined_at)
  VALUES (NEW.id, NEW.owner_id, 'owner', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_chat_sessions_updated_at BEFORE UPDATE ON chat_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_scripts_updated_at BEFORE UPDATE ON scripts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_team_members_team_id ON team_members(team_id);
CREATE INDEX idx_team_members_user_id ON team_members(user_id);
CREATE INDEX idx_clients_team_id ON clients(team_id);
CREATE INDEX idx_products_owner_id ON products(owner_id);
CREATE INDEX idx_products_client_id ON products(client_id);
CREATE INDEX idx_chat_sessions_product_id ON chat_sessions(product_id);
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_scripts_product_id ON scripts(product_id);
CREATE INDEX idx_scripts_session_id ON scripts(session_id);

-- =============================================
-- CREATE PROFILE FOR EXISTING USER
-- =============================================
INSERT INTO profiles (id, email, full_name, account_type)
SELECT id, email, raw_user_meta_data->>'full_name', 'team'
FROM auth.users
WHERE id NOT IN (SELECT id FROM profiles)
ON CONFLICT (id) DO NOTHING;
