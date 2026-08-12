# Non-admin preview test user plan

Do **not** use Rafael’s admin account for chat-shell authorization QA.

## Create user (preview project only)

Via Supabase Admin API (service role on **preview**):

```bash
curl -X POST "$PREVIEW_SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $PREVIEW_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $PREVIEW_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "chat-shell-qa@example.com",
    "password": "ReplaceMe1",
    "email_confirm": true
  }'
```

Password rules: ≥8 chars, upper, lower, digit.

Then ensure `profiles.is_admin = false` (and no privileged `role` / `account_type`) for that user.

## Seed data (preview)

1. Business A owned by QA user with products P1–P3 (`business_id` set).
2. Business B owned by a second non-admin user with product Q1.
3. Optional: collaborator viewer/editor invites on P2 for a third user.

## Authorization matrix to execute

| Actor | Action | Expected |
|-------|--------|----------|
| QA owner | Open legacy `/scripts` session for P1 | Success |
| QA owner | Create Quick session on Business A (`product_id` null) | Success |
| QA owner | Add offers P1..P3 positions 1..3 | Success |
| QA owner | Add P1 again / position 6 / Q1 | Fail |
| QA owner | Insert `message_artifacts` for P1 script | Success |
| Other owner (B) | SELECT Business A session/offers | Empty / denied |
| Viewer collab | SELECT session | Success |
| Viewer collab | INSERT message / offer | Denied |
| Admin Rafael | Not used for this matrix | — |

## Rollback

Delete the QA user from the **preview** project only. Never create this user against production unless explicitly requested.
