# Security Audit Report - Advance AI

## Audit Date: February 3, 2026

---

## Executive Summary

This document outlines security findings and recommendations before implementing Tilo Pay payment integration.

---

## 1. Database Security (Supabase RLS)

### ✅ PASS - Row Level Security Enabled
All tables have RLS enabled:
- `profiles`, `teams`, `team_members`, `clients`, `products`
- `chat_sessions`, `messages`, `scripts`, `posts`

### ✅ PASS - Team Data Isolation
RLS policies properly isolate team data:
- Team members can only access their team's clients/products
- Nested subqueries ensure proper authorization chain
- No direct access without team membership verification

### ⚠️ RECOMMENDATION - Add Subscription Table
Before payment integration, add:
```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  team_id UUID REFERENCES teams(id),
  plan TEXT CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  status TEXT CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  tilopay_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 2. API Endpoint Security

### ⚠️ WARNING - No Server-Side Auth Verification
Current API endpoints (`/api/chat.ts`, `/api/generate-image.ts`) do not verify user authentication.

**Risk:** Anyone with the endpoint URL could potentially make requests.

**Current State:** Relies on Supabase RLS for data protection, which is good, but API calls to external services (Grok, Flux) are not protected.

**Recommendation:** Add Supabase token verification to all API endpoints:
```typescript
import { createClient } from '@supabase/supabase-js'

// Verify auth header
const authHeader = req.headers.authorization
if (!authHeader || !authHeader.startsWith('Bearer ')) {
  return res.status(401).json({ error: 'Unauthorized' })
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const { data: { user }, error } = await supabase.auth.getUser(token)
if (error || !user) {
  return res.status(401).json({ error: 'Invalid token' })
}
```

### ⚠️ WARNING - Rate Limiting Not Implemented
No rate limiting on API endpoints.

**Recommendation:** Add rate limiting middleware or use Vercel's built-in limits.

---

## 3. Authentication & Registration

### ⚠️ NEEDS IMPROVEMENT - Signup Form

**Current Issues:**
1. No Google OAuth (requested feature)
2. Password only requires 6 characters minimum
3. No password confirmation field
4. No terms of service/privacy policy acceptance
5. No CAPTCHA/bot protection

**Recommendations:**
1. Add Google OAuth via Supabase
2. Strengthen password requirements (8+ chars, mixed case, numbers)
3. Add password confirmation
4. Add ToS checkbox
5. Consider adding reCAPTCHA for production

### ✅ PASS - Email Verification
Email verification is properly implemented via Supabase.

### ✅ PASS - Session Management
Supabase handles session tokens securely with automatic refresh.

---

## 4. Team Security

### ✅ PASS - Team Membership Verification
RLS policies verify team membership before data access.

### ✅ PASS - Role-Based Access
Three roles implemented: `owner`, `admin`, `member`

### ⚠️ RECOMMENDATION - Team Invitation Security
- Add invitation expiration (24-48 hours)
- Add invitation token validation
- Log team membership changes

---

## 5. Environment Variables

### ✅ PASS - Secrets Not Exposed
- API keys stored in environment variables
- Keys not exposed to client-side code

### Checklist for Tilo Pay:
- [ ] `TILOPAY_API_KEY` - Store securely in Vercel
- [ ] `TILOPAY_SECRET_KEY` - For webhook verification
- [ ] `TILOPAY_WEBHOOK_SECRET` - To validate webhook signatures

---

## 6. Subscription & Usage Limits

### ⏳ TO IMPLEMENT - Feature Gating

Before payment integration, implement:

1. **Usage Tracking Table:**
```sql
CREATE TABLE usage (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  period_start DATE,
  scripts_generated INTEGER DEFAULT 0,
  images_generated INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0
);
```

2. **Plan Limits:**
| Feature | Free | Starter | Pro | Enterprise |
|---------|------|---------|-----|------------|
| Scripts/month | 10 | 100 | Unlimited | Unlimited |
| Images/month | 5 | 50 | 500 | Unlimited |
| Team members | 1 | 3 | 10 | Unlimited |
| Clients | 1 | 5 | 25 | Unlimited |

---

## 7. Tilo Pay Integration Preparation

### Webhook Endpoint Requirements:
1. **POST `/api/tilopay/webhook`** - Receive payment events
2. **GET `/api/tilopay/webhook`** - Webhook verification (if required)

### Security Requirements:
- Verify webhook signatures
- Idempotency handling (prevent duplicate processing)
- Secure storage of payment tokens
- PCI compliance (Tilo Pay handles card data)

---

## Priority Action Items

### HIGH PRIORITY (Before Launch)
1. [ ] Add server-side auth verification to API endpoints
2. [ ] Implement Google OAuth signup
3. [ ] Strengthen password requirements
4. [ ] Add subscriptions table to database

### MEDIUM PRIORITY
5. [ ] Add usage tracking
6. [ ] Implement feature gating based on plan
7. [ ] Add rate limiting to APIs
8. [ ] Add ToS acceptance to signup

### LOW PRIORITY (Post-Launch)
9. [ ] Add CAPTCHA to signup
10. [ ] Implement audit logging
11. [ ] Add two-factor authentication option

---

## Files to Update

| File | Changes Needed |
|------|----------------|
| `src/pages/Signup.tsx` | Google OAuth, password validation, ToS |
| `src/contexts/AuthContext.tsx` | Add Google sign-in method |
| `api/chat.ts` | Add auth verification |
| `api/generate-image.ts` | Add auth verification |
| `supabase/schema.sql` | Add subscriptions, usage tables |
| `api/tilopay/webhook.ts` | NEW - Webhook handler |

