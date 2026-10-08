-- Migration 083: Ad Pack — campaign brief + offer-library persistence markers.
-- Additive and re-runnable. Apply after 082_ad_packs.sql.
--
-- ad_packs.brief: owner's campaign context ("Black Friday, focus on bundles"), sanitized,
--   <= 500 chars. Creative direction for copy prompts only, never a fact/claim.
-- ad_pack_items.library_images: renders already saved to product_images (kind 'generated'),
--   [{ ratio, imageUrl, productImageId }]. Persistence is idempotent per render URL.

alter table public.ad_packs
  add column if not exists brief text;

alter table public.ad_packs
  drop constraint if exists ad_packs_brief_len;
alter table public.ad_packs
  add constraint ad_packs_brief_len check (brief is null or char_length(brief) <= 500);

alter table public.ad_pack_items
  add column if not exists library_images jsonb not null default '[]'::jsonb;
