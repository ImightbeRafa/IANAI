-- =============================================
-- FIX RLS POLICIES - Use Security Definer Functions
-- =============================================
-- This is the standard Supabase pattern to avoid RLS recursion.
-- Security Definer functions run with the privileges of the function owner,
-- bypassing RLS checks, which breaks the recursion chain.
-- =============================================

-- Step 1: Drop ALL existing policies first
DO $$ 
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT schemaname, tablename, policyname 
        FROM pg_policies 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 
            pol.policyname, pol.schemaname, pol.tablename);
    END LOOP;
END $$;

-- Step 2: Drop old helper functions if they exist
DROP FUNCTION IF EXISTS public.user_team_ids(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.user_client_ids(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_user_team_ids() CASCADE;
DROP FUNCTION IF EXISTS public.is_team_member(UUID) CASCADE;

-- Step 3: Create Security Definer helper functions
-- These bypass RLS to check team membership without recursion

-- Returns all team_ids the current user belongs to
CREATE OR REPLACE FUNCTION public.get_user_team_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT team_id FROM team_members WHERE user_id = auth.uid()
$$;

-- Check if current user is a member of a specific team
CREATE OR REPLACE FUNCTION public.is_team_member(check_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM team_members 
        WHERE team_id = check_team_id AND user_id = auth.uid()
    )
$$;

-- Check if current user owns a specific team
CREATE OR REPLACE FUNCTION public.is_team_owner(check_team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM teams 
        WHERE id = check_team_id AND owner_id = auth.uid()
    )
$$;

-- Get all client_ids the current user has access to (via team membership)
CREATE OR REPLACE FUNCTION public.get_user_client_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT c.id FROM clients c
    WHERE c.team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
$$;

-- =============================================
-- Step 4: Create RLS Policies using helper functions
-- =============================================

-- PROFILES: Users can only access their own profile
CREATE POLICY "profiles_select" ON profiles 
    FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_insert" ON profiles 
    FOR INSERT WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update" ON profiles 
    FOR UPDATE USING (id = auth.uid());

-- TEAMS: Members can view, owners can manage
CREATE POLICY "teams_select" ON teams 
    FOR SELECT USING (public.is_team_member(id) OR owner_id = auth.uid());
CREATE POLICY "teams_insert" ON teams 
    FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "teams_update" ON teams 
    FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "teams_delete" ON teams 
    FOR DELETE USING (owner_id = auth.uid());

-- TEAM_MEMBERS: Members can view all members in their teams, owners can manage
CREATE POLICY "team_members_select" ON team_members 
    FOR SELECT USING (
        user_id = auth.uid() OR 
        public.is_team_member(team_id)
    );
CREATE POLICY "team_members_insert" ON team_members 
    FOR INSERT WITH CHECK (public.is_team_owner(team_id));
CREATE POLICY "team_members_update" ON team_members 
    FOR UPDATE USING (public.is_team_owner(team_id));
CREATE POLICY "team_members_delete" ON team_members 
    FOR DELETE USING (public.is_team_owner(team_id));

-- CLIENTS: Team members can view, team members can manage
CREATE POLICY "clients_select" ON clients 
    FOR SELECT USING (public.is_team_member(team_id));
CREATE POLICY "clients_insert" ON clients 
    FOR INSERT WITH CHECK (public.is_team_member(team_id));
CREATE POLICY "clients_update" ON clients 
    FOR UPDATE USING (public.is_team_member(team_id));
CREATE POLICY "clients_delete" ON clients 
    FOR DELETE USING (public.is_team_owner(team_id));

-- PRODUCTS: Owner OR team members (via client) can access
CREATE POLICY "products_select" ON products 
    FOR SELECT USING (
        owner_id = auth.uid() OR 
        client_id IN (SELECT public.get_user_client_ids())
    );
CREATE POLICY "products_insert" ON products 
    FOR INSERT WITH CHECK (
        owner_id = auth.uid() OR 
        client_id IN (SELECT public.get_user_client_ids())
    );
CREATE POLICY "products_update" ON products 
    FOR UPDATE USING (
        owner_id = auth.uid() OR 
        client_id IN (SELECT public.get_user_client_ids())
    );
CREATE POLICY "products_delete" ON products 
    FOR DELETE USING (
        owner_id = auth.uid() OR 
        client_id IN (SELECT public.get_user_client_ids())
    );

-- CHAT_SESSIONS: Access if user owns product OR is team member with access to product's client
CREATE POLICY "chat_sessions_select" ON chat_sessions 
    FOR SELECT USING (
        user_id = auth.uid() OR
        product_id IN (
            SELECT id FROM products 
            WHERE owner_id = auth.uid() OR client_id IN (SELECT public.get_user_client_ids())
        )
    );
CREATE POLICY "chat_sessions_insert" ON chat_sessions 
    FOR INSERT WITH CHECK (
        product_id IN (
            SELECT id FROM products 
            WHERE owner_id = auth.uid() OR client_id IN (SELECT public.get_user_client_ids())
        )
    );
CREATE POLICY "chat_sessions_update" ON chat_sessions 
    FOR UPDATE USING (
        user_id = auth.uid() OR
        product_id IN (
            SELECT id FROM products 
            WHERE owner_id = auth.uid() OR client_id IN (SELECT public.get_user_client_ids())
        )
    );
CREATE POLICY "chat_sessions_delete" ON chat_sessions 
    FOR DELETE USING (
        user_id = auth.uid() OR
        product_id IN (
            SELECT id FROM products 
            WHERE owner_id = auth.uid() OR client_id IN (SELECT public.get_user_client_ids())
        )
    );

-- MESSAGES: Access via session ownership
CREATE POLICY "messages_select" ON messages 
    FOR SELECT USING (
        session_id IN (
            SELECT id FROM chat_sessions 
            WHERE user_id = auth.uid() OR product_id IN (
                SELECT id FROM products 
                WHERE owner_id = auth.uid() OR client_id IN (SELECT public.get_user_client_ids())
            )
        )
    );
CREATE POLICY "messages_insert" ON messages 
    FOR INSERT WITH CHECK (
        session_id IN (
            SELECT id FROM chat_sessions 
            WHERE user_id = auth.uid() OR product_id IN (
                SELECT id FROM products 
                WHERE owner_id = auth.uid() OR client_id IN (SELECT public.get_user_client_ids())
            )
        )
    );

-- SCRIPTS: Access via product ownership
CREATE POLICY "scripts_select" ON scripts 
    FOR SELECT USING (
        product_id IN (
            SELECT id FROM products 
            WHERE owner_id = auth.uid() OR client_id IN (SELECT public.get_user_client_ids())
        )
    );
CREATE POLICY "scripts_insert" ON scripts 
    FOR INSERT WITH CHECK (
        product_id IN (
            SELECT id FROM products 
            WHERE owner_id = auth.uid() OR client_id IN (SELECT public.get_user_client_ids())
        )
    );
CREATE POLICY "scripts_update" ON scripts 
    FOR UPDATE USING (
        product_id IN (
            SELECT id FROM products 
            WHERE owner_id = auth.uid() OR client_id IN (SELECT public.get_user_client_ids())
        )
    );
CREATE POLICY "scripts_delete" ON scripts 
    FOR DELETE USING (
        product_id IN (
            SELECT id FROM products 
            WHERE owner_id = auth.uid() OR client_id IN (SELECT public.get_user_client_ids())
        )
    );
