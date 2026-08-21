-- Owner CRUD on brand_kits (Preview was missing INSERT/SELECT for user_id = auth.uid()).
-- Additive: keeps 062 team SELECT for business-scoped kits.
-- Also grants get_usage_limits if 061 already created it (stops PostgREST 404/403 on the RPC).

ALTER TABLE public.brand_kits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own brand kits" ON public.brand_kits;
CREATE POLICY "Users can view own brand kits"
  ON public.brand_kits
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own brand kits" ON public.brand_kits;
CREATE POLICY "Users can insert own brand kits"
  ON public.brand_kits
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own brand kits" ON public.brand_kits;
CREATE POLICY "Users can update own brand kits"
  ON public.brand_kits
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own brand kits" ON public.brand_kits;
CREATE POLICY "Users can delete own brand kits"
  ON public.brand_kits
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_usage_limits'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_usage_limits(uuid) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_usage_limits(uuid) TO service_role';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
