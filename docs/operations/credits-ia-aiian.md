/**
 * Créditos IA — ops for AIIAN (lstzfxsdmggkoaxfawny).
 *
 * Applied: schema + RPCs + bonus_images backfill (2026-08-25).
 * Enable Production env: CREDITS_V1=true and VITE_CREDITS_V1=true.
 */

# Créditos IA cutover (AIIAN)

## Policy (locked)
- Monthly plan credits: unused → **gone** at next grant (no rollover).
- Pack $25 / 500: TiloPay **one-time API** (processPayment); expires in **12 months**.
- Business $149: `https://tp.cr/l/TmpreE9BPT18MQ==`
- Starter/Premium/Enterprise: existing tp.cr links.

## Done on AIIAN
1. Migration `076` schema + RPCs applied.
2. `migrate_bonus_images_to_credits()` ran (converted leftovers × 24).

## Your env flip
1. Vercel Production: `CREDITS_V1=true`
2. Vercel Production (+ Preview if desired): `VITE_CREDITS_V1=true`
3. Redeploy after env change.

## Smoke after flag
- Settings shows Créditos IA balance
- Buy pack → TiloPay hosted URL → webhook grants 500
- Generate script/image deducts 3 / 6
- MCP EXECUTE quotes match charged
