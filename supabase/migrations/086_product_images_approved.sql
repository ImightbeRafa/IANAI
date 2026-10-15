-- 086 — MCP 0.26.0 reference rules (docs/mcp-quality.md).
--
-- product_images.approved: set ONLY by the brand owner (MCP approve_asset / unapprove_asset). Generation (execute_image_generate,
-- execute_bulk_posts, execute_campaign_pack, create_ads / adpack_start) uses ONLY approved assets.
-- product_images.asset_role: product | b-roll | unboxing | lifestyle | packaging | logo (null = inferred from role / tags / label).
-- The reference-gate vision verdict is cached in the existing product_images.quality jsonb (key "gate", by content hash).
--
-- NOT APPLIED automatically. Apply before deploying MCP 0.26.0: until it is applied the MCP adapter reports every asset as
-- NOT approved (fail closed) and the image tools refuse before charging. After applying it, existing brands must approve their
-- assets (approve_asset) before they can generate.

alter table public.product_images
  add column if not exists approved boolean not null default false;
alter table public.product_images
  add column if not exists approved_at timestamptz;
alter table public.product_images
  add column if not exists approved_by uuid references auth.users (id) on delete set null;
alter table public.product_images
  add column if not exists asset_role text;

-- The existing 085 `role` column is free text (kit part names, ≤ 60 chars) and has no value check, so it is left as it is;
-- the six asset roles live in their own column.
alter table public.product_images
  drop constraint if exists product_images_asset_role_allowed;
alter table public.product_images
  add constraint product_images_asset_role_allowed
  check (asset_role is null or asset_role in ('product', 'b-roll', 'unboxing', 'lifestyle', 'packaging', 'logo'));

alter table public.product_images
  drop constraint if exists product_images_approved_consistent;
alter table public.product_images
  add constraint product_images_approved_consistent
  check (approved = false or approved_at is not null);

create index if not exists product_images_product_approved_idx
  on public.product_images (product_id)
  where approved = true;

comment on column public.product_images.approved is 'Brand owner approved this asset as a generation reference (086). Only approved assets are used.';
comment on column public.product_images.approved_at is 'When the owner approved it (086).';
comment on column public.product_images.approved_by is 'Who approved it — always the brand owner (086).';
comment on column public.product_images.asset_role is 'product | b-roll | unboxing | lifestyle | packaging | logo (086); null = inferred.';

-- ---------------------------------------------------------------------------
-- Only the brand owner can change approved / approved_at / approved_by.
-- Row-level policies cannot restrict single columns, so a trigger enforces it for end-user (authenticated) sessions: the
-- caller must own the offer (products.owner_id = auth.uid()). The MCP server writes with the service role after its own
-- owner check (approve_asset resolves the offer by owner_id), so service_role is allowed.
-- ---------------------------------------------------------------------------
create or replace function public.product_images_guard_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.approved is distinct from old.approved)
     or (new.approved_at is distinct from old.approved_at)
     or (new.approved_by is distinct from old.approved_by) then
    if coalesce(auth.role(), '') = 'service_role' then
      return new;
    end if;
    if auth.uid() is null or not exists (
      select 1 from public.products p
      where p.id = new.product_id and p.owner_id = auth.uid()
    ) then
      raise exception 'only the brand owner can approve or unapprove an asset' using errcode = '42501';
    end if;
    if new.approved then
      new.approved_by := auth.uid();
      new.approved_at := coalesce(new.approved_at, now());
    else
      new.approved_by := null;
      new.approved_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists product_images_guard_approval on public.product_images;
create trigger product_images_guard_approval
  before update on public.product_images
  for each row execute function public.product_images_guard_approval();

-- New rows never arrive pre-approved from an end-user session.
create or replace function public.product_images_guard_approval_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approved and coalesce(auth.role(), '') <> 'service_role' then
    new.approved := false;
    new.approved_at := null;
    new.approved_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists product_images_guard_approval_insert on public.product_images;
create trigger product_images_guard_approval_insert
  before insert on public.product_images
  for each row execute function public.product_images_guard_approval_insert();
