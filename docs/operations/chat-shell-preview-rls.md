# Chat-shell Preview bootstrap notes (RLS + plan limits)

**Scope:** IANAI-preview (`adrwkzibhfdpwuycnzaa`) only.  
**Do not run these policies or seeds on production AIIAN** (`lstzfxsdmggkoaxfawny`). Do not enable production `chat_shell`. Do not apply migration `062` to production from this note.

Ops already applied the Preview-only fixes below. This doc records symptoms, root causes, policy/seed shapes, and verify steps so future Preview QA does not rediscover the same gaps.

## Symptoms (before Preview fix)

1. **Empty Brands** in `/chat` for a signed-in user who owns businesses — `getBusinesses` returned `[]` even though rows existed.
2. **New chat / Quick session insert failed or returned null** — client `insert(…).select().single()` (PostgREST `INSERT … RETURNING`) did not return the new `chat_sessions` row to the inserting user.
3. Downstream: sidebar stayed mock-empty; thread chrome never got a real session title.

## Root causes

### 1. RLS enabled with zero policies (deny-all)

On Preview, some tables had **RLS enabled** but **no policies**. With RLS on and no `SELECT`/`INSERT` policies, every authenticated client call is denied (empty result / error), including:

- `businesses`
- `products`
- `business_target_audiences`

That alone empties Brands (and related product/audience reads) even when data and `user_id` ownership are correct.

### 2. `chat_sessions` SELECT policy without owner clause (breaks `RETURNING`)

Preview `chat_sessions_select` initially allowed only:

```text
can_read_chat_session(id)
```

`INSERT … RETURNING` requires the inserting role to **SELECT** the new row under RLS. For a brand-new row, the helper `can_read_chat_session(id)` did not see / authorize that row in the `RETURNING` path, so the insert “succeeded” server-side but the authenticated client got **no row back** (null / PGRST116-style failure depending on client options).

Owner-visible SELECT fixes `RETURNING` for the creator.

## Preview-only policy shapes (already applied)

**Hard rule:** shapes below are documentation of Preview ops. **Do not apply on production AIIAN.**

### Owner (and related) access on deny-all tables

Preview added owner-oriented policies on `businesses` / `products` / `business_target_audiences` (exact names may vary; intent is: authenticated owners can read/write their own brand data under existing app conventions). Without at least `SELECT` for the owning user, Brands stays empty.

### `chat_sessions` SELECT — owner OR helper

SELECT policy should allow the owner to see their own rows **or** helper access:

```sql
-- IANAI-preview ONLY — do not run on production AIIAN
-- Intent for chat_sessions SELECT:
--   (user_id = auth.uid()) OR can_read_chat_session(id)

-- Example shape (adjust policy name to match Preview):
DROP POLICY IF EXISTS chat_sessions_select ON public.chat_sessions;

CREATE POLICY chat_sessions_select
  ON public.chat_sessions
  FOR SELECT
  TO authenticated
  USING (
    (user_id = auth.uid())
    OR can_read_chat_session(id)
  );
```

Keep INSERT constrained so creators still set `user_id = auth.uid()`, and keep ownership immutability triggers from `062` intact. This note does **not** authorize mutating `user_id` / `business_id` / `product_id` after insert.

## Verify steps (Preview, authenticated client)

Use a non-admin Preview QA user (`docs/testing/chat-shell-preview-user.md`) with at least one owned business.

1. **List businesses**  
   Authenticated anon/publishable client: `from('businesses').select('*')` (or app Brands sidebar) returns the user’s businesses — not `[]` when rows exist.

2. **New chat `INSERT … RETURNING`**  
   Insert a Quick/brand session (`business_id` set, `product_id` null, `user_id = auth.uid()`) with `.select().single()` / `RETURNING *`. The client must receive the inserted row (id + title), not null / “0 rows”.

3. **UI smoke**  
   `/chat` on Preview (`ianai-git-chat-shell-*.vercel.app`): Brands populated → **New chat** / **+ New session** / **Quick generate** create and select a session; reload keeps `?brand=&session=` when persisted.

## Empty `plan_limits` (blocks generate)

### Symptom

Authenticated Preview user can open `/chat`, pick brand/session/offer, and type in the composer, but **send/generate fails immediately** with a usage-limit style error (or “limit reached” / remaining 0) even though the account is otherwise valid. Server logs may show:

```text
Usage limit check: missing plan_limits row for plan …
```

### Root cause

`checkUsageLimit` in `api/lib/auth.ts` is **fail-closed**: if there is no `plan_limits` row for the user’s plan (defaulting to `free` when no subscription), it returns `{ allowed: false, remaining: 0, limit: 0 }`.

On a fresh IANAI-preview project, `plan_limits` can be **empty**. Script generation via `/api/chat` then always denies.

### Preview-only seed (already applied by ops)

**Do not run these seeds on production AIIAN.** Exact numeric quotas are **not** committed as a seed SQL file in this repo — do not invent production numbers here.

**Required plan keys** (must exist as `plan_limits.plan` values the app resolves):

- `free`
- `pro`
- `starter`
- `enterprise`

**Column shape expected by the app** (see `checkUsageLimit` in `api/lib/auth.ts` and `src/hooks/useUsageLimits.ts`):

| Column | Used for |
|--------|----------|
| `plan` | Plan key (`free` / `pro` / `starter` / `enterprise`) |
| `scripts_per_month` | `/api/chat` script generation |
| `images_per_month` | Image / enhance budget |
| `descriptions_per_month` | Description feature (optional; may be null-ish) |
| `replies_per_month` | Reply feature (optional; code defaults if missing) |

`-1` means unlimited for a given meter (handled in `checkUsageLimit`).

**How to populate Preview without inventing prod numbers:**

1. Read-only inventory of production AIIAN `plan_limits` (or another known-good environment), **or**
2. Align with known app/plan expectations used by billing UI,

then `INSERT`/`UPSERT` the four plan rows on **IANAI-preview only**.

### QA subscription must match a seeded plan

Seeding `plan_limits` alone is not enough if the Preview QA user has no usable subscription row. Ops set the Preview QA user’s `subscriptions` plan to **`pro`** (status `active` or `trialing`) so `checkUsageLimit` resolves `plan = 'pro'` and finds the seeded row.

**Tracked Preview QA access (intentional):** giving the Preview QA user a `pro` / high / unlimited script quota via Preview `plan_limits` + subscription is **intentional, tracked Preview-only QA access** so generate smoke can run without artificial blocks. It is **not** a production entitlement, billing policy, or a recommendation to change production AIIAN `plan_limits` / subscriptions. Do not seed or mirror this onto production.

Checklist:

1. `plan_limits` contains at least `free`, `pro`, `starter`, `enterprise`.
2. QA user has `subscriptions` row: `plan` ∈ seeded keys (e.g. `pro`), `status` ∈ (`active`, `trialing`).
3. Retry generate on Preview `/chat` with an offer attached.

### Verify generate after seed

1. As Preview QA user with `pro` (or another seeded plan): select brand → session → offer → send.  
2. Expect assistant reply + script card (not immediate usage block).  
3. Confirm production AIIAN `plan_limits` / subscriptions were **not** modified.

## `scripts` deny-all / Guardar 403 (Preview)

### Symptom

On Preview `/chat`, generate succeeds and the ScriptCard appears, but **Guardar** fails with UI **"Failed to save script"**. Browser console shows **403** on:

```text
POST …/rest/v1/scripts?select=*
```

(or equivalent PostgREST insert with `Prefer: return=representation`).

### Root cause

Same class of gap as earlier `businesses` / `products` deny-all: **`public.scripts` had RLS enabled with zero policies** (deny-all). With RLS on and no policies, every authenticated client write/read is denied → Guardar **403** on `scripts?select=*`.

Client `saveScript` uses `insert(…).select().single()` (`INSERT … RETURNING`). Both **INSERT** and **SELECT** must pass RLS for the inserting user, or the client gets 403 / no row back even when the UI otherwise works.

**No `user_id` on `scripts`.** Ownership is via `product_id` + `session_id` helper functions (`can_read_*` / `can_write_*`), not a direct owner column.

### Preview-only policies (verified live — DOCUMENT ONLY)

**Hard rule:** IANAI-preview (`adrwkzibhfdpwuycnzaa`) **ONLY**. **Do not run on production AIIAN** (`lstzfxsdmggkoaxfawny`). No master PR from this note.

**DOCUMENT ONLY.** Do **not** `DROP POLICY` / `CREATE POLICY` / re-apply from this doc. Do **not** run Supabase MCP `apply_migration` / `execute_sql`, supabase CLI, or any SQL file against Preview or prod from this tip. Ops / CoS / SecureDog own Preview DB changes.

**Ops race note:** An earlier OR-named set (`"Users can view/insert/update/delete own scripts"`) was wiped back to **zero policies** once by competing `DROP POLICY` migrations. **Never DROP-wipe live Preview** from a docs tip. Re-apply **only** if `pg_policies` for `public.scripts` is empty **and** SecureDog/CoS explicitly ask.

**Exact live Preview set (verified — 4 policies, `TO authenticated`):**

| Policy name | Cmd | Predicate |
|-------------|-----|-----------|
| `scripts_select` | SELECT | `USING (can_read_chat_session(session_id) AND can_read_product(product_id))` |
| `scripts_insert` | INSERT | `WITH CHECK (can_write_chat_session(session_id) AND can_write_product(product_id))` |
| `scripts_update` | UPDATE | `USING` + `WITH CHECK`: same write **AND** pair (`can_write_chat_session(session_id) AND can_write_product(product_id)`) |
| `scripts_delete` | DELETE | `USING (can_write_chat_session(session_id) AND can_write_product(product_id))` |

- Role: **`TO authenticated`**
- Table grants: **`authenticated`** + **`service_role`** (as applied on Preview)

```text
-- REFERENCE ONLY — already live on IANAI-preview. DO NOT RUN / DROP / CREATE from this doc.
-- DO NOT run on production AIIAN.

scripts_select  USING:      can_read_chat_session(session_id) AND can_read_product(product_id)
scripts_insert  WITH CHECK: can_write_chat_session(session_id) AND can_write_product(product_id)
scripts_update  USING + WITH CHECK: same write AND pair
scripts_delete  USING:      same write AND pair
-- TO authenticated
```

Client path: `saveScript` → `insert().select().single()` needs **INSERT + SELECT** both to pass for Guardar to return a row. Chat-shell `saveScript` always sets `session_id`, so the tight AND pair is satisfied on the shell path.

### SecureDog CONFIRM PASS (live Preview — DOCUMENT ONLY)

**SecureDog CONFIRM PASS** on the live Preview `scripts_*` **AND four** (`session ∧ product` on SELECT / INSERT / UPDATE / DELETE). **Production AIIAN untouched.**

Guidance locked by that PASS (docs only — no Preview DB churn):

1. **Prefer AND (`session ∧ product`).** Do **not** use product-only SELECT (or any product-only write path) for `scripts`.
2. **No anon policies.** No `USING (true)` / open policies on `scripts`.
3. **Pure AND blocks legacy null-session rows** — expected for the old `/scripts` path when `session_id` is null. Any AND **or** AND+null-session cutover ships only in a **reviewed migration** (not live-only ops — the DROP-wipe race already proved that).
4. **Live Preview stays the current AND four** (`scripts_select` / `scripts_insert` / `scripts_update` / `scripts_delete`). No further Preview policy churn unless SecureDog explicitly asks.
5. The **Prod cutover template** section below is the **SecureDog locked** future AIIAN **git migration** shape (null-session legacy). **Do not apply on Preview tonight.**

### Verify steps (Preview QA)

Use Preview QA user **`sup.rafa0412`** (see `docs/testing/chat-shell-preview-user.md`) on Preview QA Brand:

1. Open Preview `/chat` → select **Preview QA Brand** → session with an offer attached.  
2. Generate a script (composer send) so a ScriptCard appears.  
3. Click **Guardar** on the card.  
4. Expect: **no 403** on `POST …/rest/v1/scripts?select=*`; UI shows saved state; a `scripts` row is returned to the client (`INSERT … RETURNING`).  
5. Confirm production AIIAN `scripts` RLS / policies were **not** modified.

### Still-open / later Preview-only (non-blocking — no apply tonight)

Document-only nits. **No live DB change** from this tip. Later Preview-only if/when SecureDog/CoS ask; never prod from this note.

1. **Legacy null-session INSERT AND gap** — pure AND blocks `session_id` null (`can_write_chat_session(null)` is false). Chat-shell Guardar always sets `session_id` → OK. Old `/scripts` null-session rows stay blocked until a **reviewed migration** (AND or AND+null-session) — not live-only ops.
2. **SecureDog watch items** — keep alignment reviews on the backlog; non-blocking for shell Guardar while the live AND four remains.
3. **Future AIIAN cutover** — SecureDog locked prod git migration shape below; ships only as a reviewed git migration; do not apply that template on Preview tonight.

### Prod cutover template (SecureDog LOCKED — future AIIAN git migration; do not apply on Preview tonight)

**DOCUMENT ONLY.** This is the **SecureDog locked cutover plan** and the **prod git migration shape** for a future AIIAN migration. It ships as a **reviewed git migration**, **not** live-only ops (the DROP-wipe race already proved live-only churn is unsafe).

**Do not apply on Preview tonight.** Do not change the live Preview `scripts_*` tight AND four. Do not `DROP` / `CREATE` / re-apply from this section. No Supabase MCP / CLI / SQL apply from this tip.

Live Preview stays as-is (current verified set):

```text
scripts_select / scripts_insert / scripts_update / scripts_delete
— session_id AND product_id helpers (tight AND)
— TO authenticated
```

No further Preview policy churn unless SecureDog explicitly asks.

**SecureDog LOCKED prod git migration shape** (mirrors migration `062` `message_artifacts` spirit + null-session legacy for old `/scripts` rows). **Do NOT copy any OR SELECT/DELETE into AIIAN.** **Do NOT apply this block on IANAI-preview tonight.**

```text
-- SecureDog LOCKED — PROD (AIIAN) GIT MIGRATION SHAPE
-- Ships only as a reviewed git migration — not live-only ops
-- DO NOT apply on IANAI-preview tonight
-- DO NOT DROP-wipe live Preview from this doc

SELECT:
  can_read_product(product_id)
  AND (session_id IS NULL OR can_read_chat_session(session_id))

INSERT:
  can_write_product(product_id)
  AND can_write_chat_session(session_id)
  -- chat-shell saveScript always sets session_id

UPDATE USING + WITH CHECK:
  can_write_product(product_id)
  AND (session_id IS NULL OR can_write_chat_session(session_id))

DELETE USING:
  can_write_product(product_id)
  AND (session_id IS NULL OR can_write_chat_session(session_id))
```

Intent: product write/read remains required; `session_id IS NULL` preserves legacy `/scripts` rows that never had a chat session; shell inserts still require a writable session. When the real prod cutover migration is authored, it belongs under SecureDog/CoS ownership as a reviewed git migration — not a Preview docs tip or live-only ops apply.

## product_images (Preview — owner SELECT restored)

**Scope:** IANAI-preview only. **Do not apply blindly to production AIIAN tonight.**

### Symptom (CoS S2 smoke)

Images tab **Upload** failed with `new row violates row-level security policy`. Early diagnosis pointed at `product_images` INSERT; **CoS re-smoke on `1ef0212` confirmed the live failure was storage upsert** (see **post-images storage UPDATE** below). ScriptCard **Crear imagen** could still pass when generation used existing refs / unique storage paths.

### Root cause (062)

Migration `062` tightened INSERT:

```text
WITH CHECK (
  user_id = auth.uid()
  AND can_write_product(product_id)
  AND (session_id IS NULL OR can_write_chat_session(session_id))
)
```

and left SELECT primarily as session-reader (`session_id IS NOT NULL AND can_read_chat_session(session_id)`). Dropping **owner SELECT** made `INSERT … RETURNING` flaky/fail for the uploader when the new row was not visible under SELECT. FK `(session_id, product_id) ∈ chat_session_offers` still applies when `session_id` is set.

### Preview fix (ops — already live)

Ops restored **owner SELECT** on Preview:

```text
"Users can view own product images"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid())
```

Alongside session-reader SELECT + the INSERT WITH CHECK above. **Confirmed live on IANAI-preview** (do not re-DROP).

### Client harden (chat-shell tip)

`createProductImage` always sets `user_id` from `supabase.auth.getUser()` (JWT `auth.uid()`), never a stale React `userId` prop. When `sessionId` is provided, the client verifies `(sessionId, productId)` exists in `chat_session_offers` before insert and returns a clear error if not.

### Cutover must include

When chat-shell lands on AIIAN, the reviewed prod migration must carry:

1. **Owner SELECT** on `product_images` (`user_id = auth.uid()`), and  
2. **INSERT WITH CHECK** shape above (uid + `can_write_product` + session write when session-scoped),

plus the session-offer FK. **Do not copy Preview live-only churn onto prod tonight.**

## post-images storage UPDATE (Preview — CoS Upload upsert)

**Scope:** IANAI-preview (`adrwkzibhfdpwuycnzaa`) only. **Do not apply to production AIIAN** (`lstzfxsdmggkoaxfawny`) in this tip.

### Symptom (CoS re-smoke on `1ef0212`)

Images tab **Upload** of `tiny.png` failed with RLS: `new row violates row-level security policy`.

### Root cause (confirmed — not `product_images` INSERT)

1. Live `product_images` INSERT WITH CHECK is fine — QA SQL probe insert for Preview offer + session **succeeded** (rolled back).
2. ScriptCard **Crear imagen** on the same session/product **passed** — storage path uses unique `${Date.now()}.webp` → **INSERT**.
3. Rail Upload passed `file.name` (`tiny.png`) into `uploadProductImage(..., upsert: true)`. Object `…/product-refs/tiny.png` already existed (C3 smoke, ~07:11Z). Re-upload → storage **UPDATE**.
4. Preview `storage.objects` for bucket `post-images` had SELECT/INSERT/DELETE only — **no UPDATE policy** → RLS error on upsert overwrite.

### Preview fix (ops — already live)

Migration `preview_post_images_storage_update_rls` on IANAI-preview:

```text
"Users can update own post images"
  FOR UPDATE TO authenticated
  USING + WITH CHECK:
    bucket_id = 'post-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
```

**Prod AIIAN still lacks UPDATE today** — cutover must ship this shape; **do not apply to prod from this tip.**

### Client harden (chat-shell tip)

`uploadProductImage` / `uploadShellOfferImage` always use a **unique** object name (`${Date.now()}-…webp` via `buildUniqueProductRefFilename`) so first upload and re-upload are storage **INSERT**s and never depend on UPDATE. Upsert may remain; unique path is the hard fix. Original `file.name` stays as `product_images.label` only.

CoS can re-smoke Upload `tiny.png` against Preview even before the tip (storage UPDATE already live); the unique-filename tip still ships for defense in depth.

### Cutover must include

1. Storage **UPDATE** policy on `post-images` (owner folder = `auth.uid()`), and  
2. Prefer **unique filenames** for product-refs (never stable `tiny.png` paths).

**Do not apply Preview storage UPDATE onto prod tonight.**

## chat_sessions hard DELETE / CASCADE children (O1)

**Scope:** IANAI-preview only. **Never apply to prod AIIAN / master. Never enable prod `chat_shell`.**  
**Hard rule:** shapes below are documentation of Preview ops. **Do not re-apply** any of these migrations from this tip (no Supabase MCP / CLI / SQL against Preview or prod).

### Symptom (O1 CoS smoke)

Sidebar Delete called hard `deleteChatSession` but toast showed **Failed to delete session**; reload restored rows.

### Root causes (both mattered)

#### 1) CASCADE child RLS (supporting; necessary)

Child tables had RLS on without matching DELETE/UPDATE policies:

| Child | Parent FK | Gap |
| --- | --- | --- |
| `messages` | ON DELETE CASCADE from `chat_sessions` | no DELETE policy |
| `message_artifacts` | CASCADE (via message/session) | no DELETE policy |
| `context_documents` | CASCADE | RLS on, zero policies |
| `product_images` | ON DELETE SET NULL from `chat_sessions` | no UPDATE policy (SET NULL blocked) |
| `posts` | session-linked | no UPDATE policy to clear thread links |
| `scripts` | session-linked | DELETE too strict for some session-owned rows |

#### 2) Offer FK was **ON DELETE RESTRICT** (historical — fixed on Preview)

Migration `062` originally attached composite FKs as **RESTRICT**:

```text
posts (session_id, product_id)          → chat_session_offers ON DELETE RESTRICT
product_images (session_id, product_id) → chat_session_offers ON DELETE RESTRICT
```

Session delete → `chat_session_offers` CASCADE was **blocked** while posts/images still referenced those offers.

### Preview FK alter (ops — already live; do NOT re-apply)

Migration name on IANAI-preview: **`preview_session_offer_fks_set_null`** (SecureDog preferred)

| Constraint | Was | Now (Preview live) |
| --- | --- | --- |
| `posts_session_offer_fkey` | ON DELETE RESTRICT | **ON DELETE SET NULL** |
| `product_images_session_offer_fkey` | ON DELETE RESTRICT | **ON DELETE SET NULL** |

**Intent:** when an offer row is removed (including CASCADE from session delete), Postgres nulls the composite offer linkage on posts/images instead of blocking. **Does not CASCADE-delete** posts or product_images — assets and `product_id` ownership stay.

**Production AIIAN still has 062 RESTRICT today** — cutover must ship this FK change as a reviewed git migration later. **Do not apply `preview_session_offer_fks_set_null` onto prod from this tip.**

### Preview supporting policies (ops — already live; do NOT re-apply)

#### A) CASCADE children — migration **`preview_chat_session_delete_cascade_rls`**

- `messages_delete` — `FOR DELETE` USING `can_write_chat_session(session_id)`
- `message_artifacts_delete` — `FOR DELETE` USING `can_write_chat_session(session_id)`
- `context_documents_delete` — `FOR DELETE` USING `session_id IS NOT NULL AND can_write_chat_session(session_id)`
- `product_images_update_own` — `FOR UPDATE` so SET NULL / client clear can null `session_id`
- `scripts_delete` softened — `can_write_chat_session AND (product_id IS NULL OR can_write_product(product_id))`

#### B) Posts thread clear — migration **`preview_posts_update_for_session_delete`**

- `posts_update_thread_clear` — `FOR UPDATE` authorized via `created_by` so client (or FK SET NULL paths) can clear `session_id` / `message_id` without wiping the post row

CASCADE DELETE/UPDATE policies alone were **not** enough while offer FKs were RESTRICT; with Preview SET NULL they remain required so CASCADE children and thread-clear UPDATEs succeed under RLS.

### Client harden (chat-shell tip) — ordered cleanup + fail-closed

`deleteChatSession` (hard delete only; **no soft-archive**). Keep this even with Preview SET NULL:

1. **Before** session delete, clear thread linkage **without** destroying product ownership:
   - `product_images`: `UPDATE SET session_id = NULL, message_id = NULL WHERE session_id = :id` (keeps `product_id`)
   - `posts`: same
2. Hard-delete `chat_sessions` where `id = :id`.
3. Preview SET NULL is **schema defense-in-depth** if an offer CASCADE still touches linked rows; explicit cleanup establishes the retained-row state first and keeps the client correct on staged envs where prod has not yet received SET NULL.
4. Fail-closed: `.delete().eq('id').select('id')` — throw server `message`/`code` (e.g. **23503**) on error; throw clear “Session not deleted (RLS or missing)” on empty `data`.
5. Do **not** use `deleteSessionMessages` as hygiene. Do **not** CASCADE-delete product_images/posts when offers go away.

### Cutover must include (not tonight)

Before production cutover GO, prod AIIAN must get a **reviewed git migration** carrying:

1. Matching child DELETE/UPDATE policies (same intent as `preview_chat_session_delete_cascade_rls` + `preview_posts_update_for_session_delete`), **and**
2. Offer FK alter to **ON DELETE SET NULL** on `posts_session_offer_fkey` / `product_images_session_offer_fkey` (same intent as `preview_session_offer_fks_set_null` — retain posts/images; do not CASCADE-delete them), **and**
3. Client ordered cleanup remains as defense-in-depth across staged envs.

**Do not apply Preview cascade policies or the FK SET NULL alter onto prod from this tip. No soft-archive. No master.**

## Related docs

- Environment matrix: `docs/operations/chat-shell-environments.md`
- P0 `/chat` flag + blank-screen env notes: `docs/operations/chat-shell-p0.md`
- Preview QA user seed: `docs/testing/chat-shell-preview-user.md`
- Schema / RLS design (migration 062): `docs/adr/0001-chat-shell-foundation.md`
- Usage gate implementation: `api/lib/auth.ts` → `checkUsageLimit`
