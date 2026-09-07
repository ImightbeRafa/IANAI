# API Routes Reference

All routes in `api/*.ts` map to `/api/<filename>` on Vercel.
Auth = requires valid Supabase JWT via `requireAuth()`.

## AI generation

| Route | Auth | Timeout | Purpose |
|-------|------|---------|---------|
| `/api/chat` | ✓ | 120s | Script + description generation |
| `/api/edit-script` | ✓ | 60s | Edit existing script |
| `/api/streamline-script` | ✓ | 60s | Optimize script for posts |
| `/api/reply-chat` | ✓ | 60s | Customer DM/WhatsApp replies |
| `/api/generate-image` | ✓ | 120s | Single image generation |
| `/api/generate-carousel` | ✓ | 240s | Multi-slide organic carousels |

## Content ingestion

| Route | Auth | Purpose |
|-------|------|---------|
| `/api/auto-fill` | ✓ | AI form auto-fill from URL/text |
| `/api/fetch-url` | ✓ | URL scraping (SSRF-protected) |
| `/api/extract-pdf` | ✓ | PDF text extraction (JSON body, 10MB) |
| `/api/parse-pdf` | ✓ | PDF parsing (raw body) |
| `/api/transcribe-audio` | ✓ | OpenAI Whisper transcription |
| `/api/ocr-image` | ✓ | Image OCR |

## Memory & brand

| Route | Auth | Purpose |
|-------|------|---------|
| `/api/analyze-style` | ✓ | Style analysis for AI memory |
| `/api/reflect-memory` | ✓ | AI memory reflection |
| `/api/synthesize-memory` | ✓ | AI memory synthesis |
| `/api/extract-brand` | ✓ | Brand extraction from URL |

## Admin

| Route | Auth | Purpose |
|-------|------|---------|
| `/api/admin-billing` | ✓ Admin | Billing analytics |
| `/api/admin-image-performance` | ✓ Admin | Image model performance |
| `/api/admin-usage` | ✓ Admin | Usage/cost analytics (`api_usage_logs` via service role) |

## Account

| Route | Auth | Purpose |
|-------|------|---------|
| `/api/my-usage` | ✓ | Signed-in user usage history (own `credit_ledger` + `api_usage_logs` only) |

## Tickets

| Route | Auth | Purpose |
|-------|------|---------|
| `/api/ticket-events` | GET: `TICKETS_WEBHOOK_SECRET` or admin JWT; POST: user JWT | Preview-safe ticket.created poll + optional outbound POST to `TICKETS_EVENT_WEBHOOK_URL` (`feedback_tickets`) |

## Payments (TiloPay)

| Route | Auth | Purpose |
|-------|------|---------|
| `/api/tilopay/webhook` | Secret param | Payment webhooks |
| `/api/tilopay/create-checkout` | ✓ | Checkout URL generation |
| `/api/tilopay/confirm-boost` | ✓ | Image boost purchase confirm |

## Standard API handler pattern

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireAuth, checkUsageLimit, incrementUsage } from './lib/auth.js'
import { checkRateLimit } from './lib/rate-limit.js'
import { logApiUsage } from './lib/usage-logger.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const user = await requireAuth(req, res)
  if (!user) return

  // checkRateLimit, checkUsageLimit before AI calls
  // logApiUsage + incrementUsage after AI calls
}
```

## AI providers by route

| Provider | Env var | Used for |
|----------|---------|----------|
| xAI Grok | `GROK_API_KEY` | Text (`grok-4.3`), images (`grok-imagine`) |
| Google Gemini | `GEMINI_API_KEY` | Text + image models |
| OpenAI | `OPENAI_API_KEY` | Whisper, GPT Image 2 (admin) |

## Dev vs prod URLs

- **Dev:** frontend services call `http://localhost:3000/api/...`
- **Prod:** relative `/api/...` (same origin via Vercel)
