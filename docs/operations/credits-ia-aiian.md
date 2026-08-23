/**
 * Créditos IA — human ops for AIIAN (lstzfxsdmggkoaxfawny).
 *
 * Agent must NOT apply this migration. Review `supabase/migrations/076_credits_ia.sql`
 * then apply in Supabase SQL editor / CLI as a human.
 */

# Créditos IA cutover (AIIAN)

## Already wired in code
- Catalog: `api/lib/credits/catalog.ts`
- FIFO + consume: `api/lib/credits/fifo.ts`, `consume.ts`
- Flag: `CREDITS_V1=true` (Production only after migrate)
- TiloPay links live: Starter $33, Premium $49, Enterprise $299
- Placeholders (paste later): Business $149, Credit pack $25/500

## Human steps
1. Read-only inventory: `select plan, scripts_per_month, images_per_month from plan_limits;`
2. Apply `076_credits_ia.sql` on AIIAN.
3. Optional: `select public.migrate_bonus_images_to_credits();` (converts bonus_images × 24).
4. Create TiloPay products if missing; paste URLs into `PLAN_CATALOG.business.paymentLink` and `CREDIT_PACK.paymentLink` (and Settings mirror).
5. Point Business + pack payment link webhooks at existing `/api/tilopay/webhook?event=…&secret=…`.
6. Set Vercel Production env `CREDITS_V1=true`. Keep Preview off until smoke passes.
7. Partner notice: Meta AdVance → 600 créditos/mo; Enterprise → 9600 (no ∞ images).

## Do not
- Copy Preview `plan_limits` / unlimited QA rows onto AIIAN
- Enable `CREDITS_V1` before migration
- Sell legacy `image_boost` ($14.99) after cutover
