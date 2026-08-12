# Chat-shell backfill strategy

Migration `062` intentionally **does not** backfill `chat_sessions.business_id`.

## Why

Shell FKs require `products.business_id` to match `chat_sessions.business_id` when both are set. Auto-backfilling from `products.business_id` would:

- Freeze historical sessions to today’s product→business mapping
- Surprise owners who later move a product across businesses
- Mix null-`business_id` products into offer FKs incorrectly

## Suggested staged plan (human-operated on preview first)

1. **Inventory**

```sql
SELECT COUNT(*) AS sessions,
       COUNT(*) FILTER (WHERE business_id IS NULL) AS missing_business,
       COUNT(*) FILTER (WHERE product_id IS NULL) AS quick_style
FROM chat_sessions;

SELECT COUNT(*) FILTER (WHERE business_id IS NULL) AS products_without_business
FROM products;
```

2. **Dry-run mapping** (read-only): session → `products.business_id` where non-null.

3. **Backfill products without business** only when the owner confirms the target brand.

4. **Backfill sessions** in batches:

```sql
-- PREVIEW ONLY example — review row counts before prod
UPDATE chat_sessions cs
SET business_id = p.business_id
FROM products p
WHERE cs.product_id = p.id
  AND cs.business_id IS NULL
  AND p.business_id IS NOT NULL;
```

5. **Brand kits:** set `brand_kits.business_id` deliberately per kit; do not mass-assign.

6. **Rollback criteria:** if any owner reports wrong brand on a session, stop batch, restore from backup / inverse update using logged ids.

## Defaults for new shell writes

- Brand session: require `business_id`.
- Quick session: `business_id` set, `product_id` null, offers added explicitly.
- Legacy UI: continue inserting `product_id` only until client cutover.
