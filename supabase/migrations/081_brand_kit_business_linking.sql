-- Brand kit ↔ business linking: primary-for-business + safe name backfill.
-- Fixes MCP get_brand_context returning null when Settings kits have business_id IS NULL
-- (e.g. PatchHouse.CR Principal kit not linked to the PatchHouse.CR folder).

ALTER TABLE public.brand_kits
  ADD COLUMN IF NOT EXISTS is_primary_for_business boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.brand_kits.is_primary_for_business IS
  'When true and business_id is set, this kit is the default for MCP/web resolution for that brand folder. Distinct from is_default (account-wide Principal).';

-- At most one primary kit per linked business
CREATE UNIQUE INDEX IF NOT EXISTS brand_kits_one_primary_per_business_uidx
  ON public.brand_kits (business_id)
  WHERE business_id IS NOT NULL AND is_primary_for_business = true;

CREATE INDEX IF NOT EXISTS brand_kits_business_active_primary_idx
  ON public.brand_kits (business_id, is_active, is_primary_for_business)
  WHERE business_id IS NOT NULL;

-- Atomic set-primary for a business (clears other primaries on that business)
CREATE OR REPLACE FUNCTION public.set_primary_brand_kit(p_kit_id uuid, p_business_id uuid)
RETURNS public.brand_kits
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kit public.brand_kits;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_kit_id IS NULL OR p_business_id IS NULL THEN
    RAISE EXCEPTION 'kit id and business id required';
  END IF;

  -- Caller must own both kit and business
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = p_business_id AND b.owner_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Brand not found or not owned';
  END IF;

  UPDATE public.brand_kits
  SET is_primary_for_business = false,
      updated_at = now()
  WHERE business_id = p_business_id
    AND user_id = v_uid
    AND is_primary_for_business = true
    AND id IS DISTINCT FROM p_kit_id;

  UPDATE public.brand_kits
  SET business_id = p_business_id,
      is_primary_for_business = true,
      is_active = COALESCE(is_active, true),
      updated_at = now()
  WHERE id = p_kit_id
    AND user_id = v_uid
  RETURNING * INTO v_kit;

  IF v_kit.id IS NULL THEN
    RAISE EXCEPTION 'Brand kit not found or not owned';
  END IF;

  RETURN v_kit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_primary_brand_kit(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_primary_brand_kit(uuid, uuid) TO service_role;

-- Backfill: link unlinked kits to uniquely name-matched owned businesses (exact normalized name).
WITH candidates AS (
  SELECT
    k.id AS kit_id,
    b.id AS business_id,
    k.user_id,
    ROW_NUMBER() OVER (
      PARTITION BY k.id
      ORDER BY b.created_at ASC NULLS LAST, b.id
    ) AS biz_rn,
    COUNT(*) OVER (PARTITION BY k.id) AS biz_count
  FROM public.brand_kits k
  INNER JOIN public.businesses b
    ON b.owner_id = k.user_id
   AND lower(trim(b.name)) = lower(trim(k.name))
  WHERE k.business_id IS NULL
    AND coalesce(k.is_active, true) = true
    AND nullif(trim(k.name), '') IS NOT NULL
),
unique_links AS (
  SELECT kit_id, business_id, user_id
  FROM candidates
  WHERE biz_count = 1 AND biz_rn = 1
)
UPDATE public.brand_kits k
SET business_id = u.business_id,
    updated_at = now()
FROM unique_links u
WHERE k.id = u.kit_id
  AND k.business_id IS NULL;

-- For each linked business, ensure exactly one primary (prefer active, then is_default, then oldest).
WITH ranked AS (
  SELECT
    id,
    business_id,
    ROW_NUMBER() OVER (
      PARTITION BY business_id
      ORDER BY
        CASE WHEN coalesce(is_active, true) THEN 0 ELSE 1 END,
        CASE WHEN coalesce(is_default, false) THEN 0 ELSE 1 END,
        created_at ASC NULLS LAST,
        id
    ) AS rn
  FROM public.brand_kits
  WHERE business_id IS NOT NULL
)
UPDATE public.brand_kits k
SET is_primary_for_business = (r.rn = 1),
    updated_at = now()
FROM ranked r
WHERE k.id = r.id
  AND k.is_primary_for_business IS DISTINCT FROM (r.rn = 1);

NOTIFY pgrst, 'reload schema';
