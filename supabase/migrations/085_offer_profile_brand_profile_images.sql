-- Migration 085: MCP premium round — structured offer/brand profiles, brand archive flag,
-- product photo selection metadata. Additive and re-runnable. Apply after 084.
--
-- Owner feedback (2026-10-08 Grok Bot test) B1/B3/B4/B5/C2/C3/A2:
--   products.ad_profile        structured ad facts typed once by the owner (create_offer / update_offer):
--                              { price {amount,currency CRC|USD}, compareAtPrice, bundles [{qty,amount,currency,label}],
--                                shipping {text,freeFromQty,freeFromAmount}, includes[], excludes[], allowedClaims[],
--                                forbiddenClaims[], verifiedClaims [{claim,source}], cta {text,channels[]}, ageMin,
--                                immutableAttributes[], lockProductAppearance, allowedProps[], locale, updatedAt }
--   brand_kits.brand_profile   { audiences [{label,ageMin,ageMax,geo}], locale, register voseo|tuteo|usted,
--                                do[], dont[], logoVariants [{url,variant,sourceUrl}], styleDnaIds[], winnerAdUrls[],
--                                documents [{url,filename}], updatedAt }
--   businesses.archived_at     soft archive (archive_brand); hidden from list_brands by default. Recoverable.
--   product_images.is_primary  one primary photo per offer (set_primary_product_image)
--   product_images.tags        hero | contenido-kit | caja | en-uso | detalle | part (tag_product_image)
--   product_images.role        free role, e.g. "control", "caja", "contenido" (one real photo per kit part)
--   product_images.quality     { width, height, sharpness, cleanBackground, ... } filled by the quality workstream
--   product_images.source_url  original external URL when a file was copied into Advance storage (rehost)
--
-- RLS: only columns are added to tables that already have owner RLS (products: owner_id, brand_kits:
-- user_id (065), businesses: owner_id, product_images: user_id). No new policies are needed; the MCP
-- server uses the service role with explicit owner filters on every query.
--
-- The code feature-detects every column below (PostgREST 42703 / PGRST204) and keeps working before
-- this migration is applied: offers/kits save their classic fields and report the structured part as
-- "migration pending"; archive falls back to the mcp_workspace_notes marker; image tags/primary report
-- MIGRATION_PENDING.

-- ---------------------------------------------------------------------------
-- products.ad_profile
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists ad_profile jsonb not null default '{}'::jsonb;

alter table public.products
  drop constraint if exists products_ad_profile_is_object;
alter table public.products
  add constraint products_ad_profile_is_object check (jsonb_typeof(ad_profile) = 'object');

comment on column public.products.ad_profile is
  'Structured ad facts (085): price/bundles/shipping/includes/excludes/claims/cta/age/product lock. Exact strings become confirmed Ad Pack facts.';

-- ---------------------------------------------------------------------------
-- brand_kits.brand_profile
-- ---------------------------------------------------------------------------
alter table public.brand_kits
  add column if not exists brand_profile jsonb not null default '{}'::jsonb;

alter table public.brand_kits
  drop constraint if exists brand_kits_brand_profile_is_object;
alter table public.brand_kits
  add constraint brand_kits_brand_profile_is_object check (jsonb_typeof(brand_profile) = 'object');

comment on column public.brand_kits.brand_profile is
  'Structured kit profile (085): audiences, locale, register (hard rule), do/dont, logo variants, styleDnaIds, winner ads, documents.';

-- ---------------------------------------------------------------------------
-- businesses.archived_at (soft archive)
-- ---------------------------------------------------------------------------
alter table public.businesses
  add column if not exists archived_at timestamptz;

create index if not exists businesses_owner_active_idx
  on public.businesses (owner_id, created_at desc)
  where archived_at is null;

comment on column public.businesses.archived_at is
  'Soft archive (085, MCP archive_brand). Hidden from list_brands by default; set back to null to restore.';

-- Backfill from the pre-085 archive marker (mcp_workspace_notes kind brand_archived).
update public.businesses b
set archived_at = n.archived_at
from (
  select business_id, min(created_at) as archived_at
  from public.mcp_workspace_notes
  where kind = 'brand_archived'
  group by business_id
) n
where b.id = n.business_id
  and b.archived_at is null;

-- ---------------------------------------------------------------------------
-- product_images: primary / tags / role / quality / source_url
-- ---------------------------------------------------------------------------
alter table public.product_images
  add column if not exists is_primary boolean not null default false;
alter table public.product_images
  add column if not exists tags text[] not null default '{}'::text[];
alter table public.product_images
  add column if not exists role text;
alter table public.product_images
  add column if not exists quality jsonb;
alter table public.product_images
  add column if not exists source_url text;

alter table public.product_images
  drop constraint if exists product_images_tags_allowed;
alter table public.product_images
  add constraint product_images_tags_allowed
  check (tags <@ array['hero', 'contenido-kit', 'caja', 'en-uso', 'detalle', 'part']::text[]);

alter table public.product_images
  drop constraint if exists product_images_role_len;
alter table public.product_images
  add constraint product_images_role_len check (role is null or char_length(role) <= 60);

alter table public.product_images
  drop constraint if exists product_images_quality_is_object;
alter table public.product_images
  add constraint product_images_quality_is_object check (quality is null or jsonb_typeof(quality) = 'object');

-- At most one primary photo per offer. set_primary_product_image clears the old one first.
create unique index if not exists product_images_one_primary_per_product
  on public.product_images (product_id)
  where is_primary = true;

create index if not exists product_images_product_tags_idx
  on public.product_images using gin (tags);

comment on column public.product_images.is_primary is 'Hero photo of the offer (085). Beats "newest upload".';
comment on column public.product_images.tags is 'hero | contenido-kit | caja | en-uso | detalle | part (085).';
comment on column public.product_images.role is 'Kit part / role of the photo, e.g. "control" (085).';
comment on column public.product_images.quality is 'Asset quality metrics (085), e.g. { width, height, sharpness 0-1, cleanBackground }.';
comment on column public.product_images.source_url is 'Original external URL when the file was copied into Advance storage (085).';

-- Grants unchanged: tables keep their existing grants/RLS; service_role already has full access.

notify pgrst, 'reload schema';
