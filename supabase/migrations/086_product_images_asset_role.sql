-- 086 — MCP 0.26.0 asset roles (docs/mcp-quality.md). OPTIONAL.
--
-- product_images.asset_role: product | b-roll | unboxing | lifestyle | packaging | logo (null = inferred from the 085 role / tags /
-- label). Written by the MCP tool set_asset_role; used to pick varied references (hero + another angle / packaging + lifestyle).
--
-- NOT APPLIED automatically. The code works without it: a missing column means "no explicit role" (inferred), never a block;
-- only set_asset_role answers MIGRATION_PENDING until it is applied. No approval column: generation needs no approval step.

alter table public.product_images
  add column if not exists asset_role text;

-- The existing 085 `role` column is free text (kit part names, ≤ 60 chars), so the six asset roles live in their own column.
alter table public.product_images
  drop constraint if exists product_images_asset_role_allowed;
alter table public.product_images
  add constraint product_images_asset_role_allowed
  check (asset_role is null or asset_role in ('product', 'b-roll', 'unboxing', 'lifestyle', 'packaging', 'logo'));

comment on column public.product_images.asset_role is 'product | b-roll | unboxing | lifestyle | packaging | logo (086); null = inferred.';
