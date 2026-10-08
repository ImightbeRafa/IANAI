-- Migration 084: Ad Pack — one product_images row per saved render.
-- Additive and re-runnable. Apply after 083_ad_pack_brief_library.sql.
--
-- The Ad Pack engine saves every finished render to the offer library
-- (api/lib/adpack/library.ts) as a product_images row:
--   { product_id, user_id, image_url, label: 'Ad Pack <pack8> #<n> <ratio> — <headline>', kind: 'generated' }
-- It checks for an existing (product_id, user_id, image_url) row before inserting, but a
-- background worker and a status poll can race past that check. This partial unique index
-- makes the second insert fail with 23505, which the code treats as "already saved".
--
-- Scope: only Ad Pack rows (kind 'generated' + the 'Ad Pack ' label prefix written by
-- libraryLabel). Other generated images (chat shell, MCP generate, uploads) keep their
-- current behaviour, and rows with very long image_url values (e.g. data: URLs) elsewhere
-- in the table cannot break the index build. The code works with or without this index.
--
-- BEFORE APPLYING: the index build fails if duplicates already exist. Check with:
--
--   select product_id, user_id, image_url, count(*)
--   from public.product_images
--   where kind = 'generated' and label like 'Ad Pack %'
--   group by 1, 2, 3
--   having count(*) > 1;
--
-- If that returns rows, keep the oldest row of each group and delete the rest
-- (safe: duplicates point at the same image URL. ad_pack_items.library_images may then still
-- list a deleted row id; that id is informational only — libraryImageIds in status — and the
-- image itself stays in the library through the kept row):
--
--   delete from public.product_images dup
--   using public.product_images keep
--   where dup.kind = 'generated' and dup.label like 'Ad Pack %'
--     and keep.kind = 'generated' and keep.label like 'Ad Pack %'
--     and dup.product_id = keep.product_id
--     and dup.user_id = keep.user_id
--     and dup.image_url = keep.image_url
--     and (dup.created_at, dup.id) > (keep.created_at, keep.id);

create unique index if not exists product_images_adpack_render_unique
  on public.product_images (product_id, user_id, image_url)
  where kind = 'generated' and label like 'Ad Pack %';

comment on index public.product_images_adpack_render_unique is
  'Ad Pack: one library row per saved render URL per offer (084). Insert conflicts (23505) are treated as already saved.';
