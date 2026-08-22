-- Bridge classic (product-scoped) sessions into chat-shell brand folders.
-- resolved_business_id = session.business_id OR products.business_id
-- Does not mutate rows; backfill of business_id is a separate ops step.

CREATE INDEX IF NOT EXISTS idx_chat_sessions_product_status_updated
  ON public.chat_sessions (product_id, status, updated_at DESC)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_business_id_id
  ON public.products (business_id, id)
  WHERE business_id IS NOT NULL;

CREATE OR REPLACE VIEW public.chat_sessions_resolved
WITH (security_invoker = true) AS
SELECT
  cs.*,
  COALESCE(cs.business_id, p.business_id) AS resolved_business_id
FROM public.chat_sessions cs
LEFT JOIN public.products p ON p.id = cs.product_id;

REVOKE ALL ON TABLE public.chat_sessions_resolved FROM PUBLIC;
GRANT SELECT ON TABLE public.chat_sessions_resolved TO authenticated, service_role;
