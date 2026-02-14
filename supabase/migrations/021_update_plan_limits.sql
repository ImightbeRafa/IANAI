-- =============================================
-- Migration 021: Update plan limits to match actual pricing
-- Starter ($27): unlimited scripts, 50 images
-- Pro ($99): unlimited scripts, 200 images
-- Free: 10 scripts, 5 images
-- Enterprise: unlimited everything
-- =============================================

UPDATE plan_limits SET
  scripts_per_month = -1,
  images_per_month = 50,
  price_monthly = 2700,
  price_yearly = 27000
WHERE plan = 'starter';

UPDATE plan_limits SET
  scripts_per_month = -1,
  images_per_month = 200,
  price_monthly = 9900,
  price_yearly = 99000
WHERE plan = 'pro';

-- Verify
SELECT plan, scripts_per_month, images_per_month, price_monthly FROM plan_limits ORDER BY price_monthly NULLS LAST;
