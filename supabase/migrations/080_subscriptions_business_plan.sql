-- Allow Business plan on subscriptions (TiloPay webhook upserts).
-- Applied on AIIAN 2026-08-25.

alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions add constraint subscriptions_plan_check
  check (plan = any (array[
    'free'::text,
    'starter'::text,
    'pro'::text,
    'business'::text,
    'enterprise'::text,
    'meta_advanze'::text
  ]));
