# Chat-shell AIIAN canary runbook

Use after the production pack in `supabase/production/aiian/chat-shell/` has been **human-reviewed and applied**.  
This runbook does **not** authorize the agent to apply SQL or flip flags.

## Goals

- Keep **classic** as the default home for everyone.
- Let **one invited account** jump classic ↔ chat on real production data.
- Prove brands/offers/usage display correctly without mass cutover.
- Only then consider a **single protected** Vercel preview pointed at AIIAN.

## Preconditions

- [ ] Inventory reviewed: `docs/operations/chat-shell-aiian-inventory.md`
- [ ] Preflight output saved from `01_preflight_read_only.sql`
- [ ] `02` + `03` applied; `04_postflight` shows `chat_shell.enabled = false`
- [ ] Production deploy includes chat-shell code with fail-closed rollout
- [ ] PITR / backup window confirmed
- [ ] Canary email chosen (internal). Synthetic brand naming agreed (e.g. `CANARY — do not use`)

## Phase A — schema live, flag still off

1. Deploy chat-shell-capable build to production (`ianai-omega`) with AIIAN env pairing unchanged.
2. Confirm every normal user still lands on classic `/dashboard`.
3. Confirm `/chat` is blocked / fail-closed while flag is off.

## Phase B — enable kill switch (still no mass redirect)

Ops / service role only:

```sql
UPDATE public.app_feature_flags
SET enabled = true, updated_at = now()
WHERE key = 'chat_shell';
```

Expect: uninvited users still classic; no automatic jump to `/chat`.

## Phase C — invite one canary (preference stays classic)

```sql
UPDATE public.profiles
SET chat_beta_access = true
-- preferred_ui stays 'classic'
WHERE email = 'CANARY_EMAIL_HERE';
```

Canary uses **Probar Chat** / **Volver al panel clásico**.

## Phase D — verification ledger (stop on any fail)

| Check | Pass criteria |
|-------|----------------|
| Login | Canary signs in with real AIIAN Auth |
| Classic intact | Dashboard, scripts, posts, usage banner still work |
| Jump | Probar Chat opens `/chat`; Volver returns classic |
| Uninvited control | Second account cannot open `/chat` / shell APIs 403 |
| Read real brands | Existing businesses/products appear under correct owner only |
| Write only synthetic | Create `CANARY — …` brand; do **not** edit customer brands |
| Offers / scripts / images | One generate → one usage increment (`get_usage_limits`) |
| Folder switch | No foreign offer bleed; no jumpy remount |
| Session delete | Synthetic session delete retains posts/images product rows |
| Cross-user | Foreign session/product/image IDs denied |
| Logs | No recurring 403/406/FK storms |

## Phase E — optional protected prod-data preview (later approval)

Only after Phase D passes:

1. One locked Vercel branch/alias with **AIIAN** `VITE_*` + service role paired.
2. Deployment Protection on.
3. No TiloPay webhook target on that deployment.
4. Same invite gate; never point all preview branches at AIIAN.

## Rollback

```sql
UPDATE public.app_feature_flags
SET enabled = false, updated_at = now()
WHERE key = 'chat_shell';

UPDATE public.profiles
SET chat_beta_access = false, preferred_ui = 'classic'
WHERE email = 'CANARY_EMAIL_HERE';
```

Flag-off stops new shell access; it does not undo rows already written. Prefer synthetic-only writes during canary.

## Explicit non-goals

- Auto-enroll admins or all users
- Auto-backfill legacy `chat_sessions.business_id`
- Copy Preview RLS/seeds onto AIIAN
- Merge to master as a silent “everyone is on chat now” switch
