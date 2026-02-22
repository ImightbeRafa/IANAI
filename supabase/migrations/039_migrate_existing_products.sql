-- =============================================
-- 039: Migrate Existing Products to Business Context
-- Auto-create a default business per user and link existing products
-- =============================================

-- Create a default business for each user who has products but no business
INSERT INTO businesses (owner_id, name, sales_channels, does_shipping)
SELECT DISTINCT
  p.owner_id,
  'Mi Negocio',
  ARRAY['messages']::TEXT[],
  false
FROM products p
WHERE p.owner_id IS NOT NULL
  AND p.business_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM businesses b WHERE b.owner_id = p.owner_id AND b.client_id IS NULL
  );

-- Create a default business for each client that has products but no business
INSERT INTO businesses (owner_id, client_id, name, sales_channels, does_shipping)
SELECT DISTINCT
  p.owner_id,
  p.client_id,
  COALESCE(c.name, 'Negocio'),
  ARRAY['messages']::TEXT[],
  false
FROM products p
JOIN clients c ON c.id = p.client_id
WHERE p.client_id IS NOT NULL
  AND p.business_id IS NULL
  AND p.owner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM businesses b WHERE b.client_id = p.client_id
  );

-- Link orphaned individual products to their owner's default business
UPDATE products p
SET business_id = (
  SELECT b.id FROM businesses b
  WHERE b.owner_id = p.owner_id
    AND b.client_id IS NULL
  ORDER BY b.created_at ASC
  LIMIT 1
)
WHERE p.business_id IS NULL
  AND p.client_id IS NULL
  AND p.owner_id IS NOT NULL;

-- Link orphaned client products to their client's business
UPDATE products p
SET business_id = (
  SELECT b.id FROM businesses b
  WHERE b.client_id = p.client_id
  ORDER BY b.created_at ASC
  LIMIT 1
)
WHERE p.business_id IS NULL
  AND p.client_id IS NOT NULL;
