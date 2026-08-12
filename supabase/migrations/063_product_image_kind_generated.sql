-- Preview C3: allow generated product_images.kind (additive; does not widen position CHECK).
-- Safe to apply on Preview chat-shell DB. Do not treat as prod cutover.

ALTER TABLE public.product_images
  DROP CONSTRAINT IF EXISTS product_images_kind_check;

ALTER TABLE public.product_images
  ADD CONSTRAINT product_images_kind_check
  CHECK (kind IN ('product', 'context', 'generated'));

COMMENT ON COLUMN public.product_images.kind IS
  'product = reference truth; context = mood/lifestyle; generated = AI output (chat-shell C3)';
