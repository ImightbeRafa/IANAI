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

## Related docs

- Environment matrix: `docs/operations/chat-shell-environments.md`
- P0 `/chat` flag + blank-screen env notes: `docs/operations/chat-shell-p0.md`
- Preview QA user seed: `docs/testing/chat-shell-preview-user.md`
- Schema / RLS design (migration 062): `docs/adr/0001-chat-shell-foundation.md`
- Usage gate implementation: `api/lib/auth.ts` → `checkUsageLimit`
