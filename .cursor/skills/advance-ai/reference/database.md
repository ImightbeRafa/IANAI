# Database Reference

**Important:** `supabase/` is gitignored. Schema is inferred from code, not migration files in repo.

## Clients

| Client | File | Key |
|--------|------|-----|
| Browser | `src/lib/supabase.ts` | `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Server | `api/lib/supabase-admin.ts` | `SUPABASE_SECRET_KEY` |

## Data access layer

All frontend CRUD: `src/services/database.ts` (~1760 lines).
Domain types: `src/types/index.ts` (~900 lines).

Do not add direct Supabase queries in components — extend `database.ts`.

## Core tables

| Table | Purpose |
|-------|---------|
| `profiles` | Users; `account_type`, `is_admin`, `bonus_images`, onboarding |
| `teams`, `team_members` | Team accounts |
| `clients` | Team client folders |
| `businesses`, `business_target_audiences` | Business (negocio) context |
| `products` | Products/services (wide nullable columns per type) |
| `service_success_cases` | Service social proof |
| `chat_sessions`, `messages` | Script generation sessions |
| `scripts`, `script_templates` | Saved scripts + templates |
| `context_documents` | Session PDFs/URLs/text |
| `posts` | Generated images |
| `subscriptions`, `usage`, `plan_limits`, `payments` | Billing |
| `api_usage_logs` | Admin cost tracking |
| `ai_memories` | Typed AI learning |
| `brand_kits` | Brand identity |
| `reply_sessions`, `reply_messages`, `reply_context_sources` | Respuestas feature |
| `custom_post_types`, `product_images`, `product_collaborators` | Posts/sharing |
| `feedback_tickets` | User feedback |

## Product column prefixes

| Prefix | Type |
|--------|------|
| (none) | `product` |
| `svc_*` | `service` |
| `ind_*` | `indumentaria` |
| `re_*` | `real_estate` |
| (no prefix) | `restaurant` uses `menu_text`, `location`, etc. |

## RPC functions (referenced in code)

- `get_usage_limits`
- `increment_usage`
- `deduct_bonus_image`
- `check_usage_limit`

## Hierarchy

```
Single user:
  profiles → businesses → products → chat_sessions → scripts

Team:
  teams → team_members
  teams → clients → businesses → products → chat_sessions → scripts
```

## Storage

Supabase Storage used for product images, menu PDFs, brand assets.
Image compression client-side: `src/utils/imageCompression.ts`.
