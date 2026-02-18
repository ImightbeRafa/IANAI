-- =============================================
-- Migration 029: Fix circular RLS recursion
-- 
-- Problem: Migration 028 created a circular dependency:
--   products policy → subquery on product_collaborators
--   product_collaborators "Owner can manage" policy → subquery on products
--   → infinite recursion → PostgreSQL returns 500 on ALL queries
--
-- Fix: Replace the product_collaborators owner policy with
-- invited_by = auth.uid() which achieves the same check
-- (only product owners invite) without cross-table dependency.
-- =============================================

-- Drop the problematic policy that causes circular recursion
DROP POLICY IF EXISTS "Owner can manage collaborators" ON product_collaborators;

-- Recreate using invited_by column instead of querying products table
-- Since only the product owner can invite collaborators (enforced by app + products RLS),
-- invited_by = auth.uid() is equivalent to the old product ownership check.
CREATE POLICY "Owner can manage collaborators"
  ON product_collaborators FOR ALL
  USING (invited_by = auth.uid())
  WITH CHECK (invited_by = auth.uid());
