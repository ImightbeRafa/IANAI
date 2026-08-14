# Architecture Reference

## System diagram

```
┌─────────────────────────────────────────────────────────┐
│  React SPA (Vite, port 5173)                            │
│  src/pages → src/services → src/contexts                │
└────────────────────┬────────────────────────────────────┘
                     │ Bearer JWT (Supabase session)
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Vercel Serverless (api/*.ts, port 3000 in dev)         │
│  auth → rate-limit → usage-limit → AI call → log usage  │
└──────┬──────────┬──────────┬──────────┬─────────────────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
   Supabase    xAI Grok   Gemini    OpenAI
   (Auth+DB)   (text+img) (text+img) (Whisper+GPT Image)
       ▲
       │ Webhooks
   TiloPay (CRC subscriptions)
```

## Feature modules

### Auth & plans
- `src/contexts/AuthContext.tsx` — session, Google OAuth, `isAdmin`
- `src/components/ProtectedRoute.tsx` — auth guard, optional `requireAdmin`
- `api/lib/auth.ts` — server JWT, `checkUsageLimit`, `incrementUsage`
- `src/hooks/useUsageLimits.ts` + `UsageBanner.tsx` — client display only

### Business → Product forms
- `BusinessForm.tsx` — negocio, sales channels, audiences
- Type-specific: `ProductForm`, `ServiceForm`, `RestaurantForm`, `RealEstateForm`, `IndumentariaForm`
- `ProductTypeSelector.tsx` — type picker
- `AutoFillButtons.tsx` + `/api/auto-fill`, `/api/fetch-url` — URL/text auto-fill

### Guiones (scripts)
- UI: `ProductWorkspace.tsx`, `ScriptSettingsPanel.tsx`, `ScriptCard.tsx`
- Client: `grokApi.ts` → `POST /api/chat`
- Parser: `scriptParser.ts`
- Pipeline: `api/lib/guiones/*` (structured) + `api/chat.ts` (legacy fallback)
- Edit: `/api/edit-script`, `/api/streamline-script`

### Posts
- UI: `PostsDashboard.tsx`, `PostWorkspace.tsx`, `OrganicCarouselModal.tsx`
- APIs: `/api/generate-image`, `/api/generate-carousel`
- Models: nano-banana, nano-banana-pro, grok-imagine, gpt-image-2 (admin)
- Presets: `api/data/image-presets.ts`, `api/data/organic-post-prompts.ts`

### Descriptions
- `DescriptionsWorkspace.tsx` → `/api/chat` with `feature: 'description'`

### Respuestas
- `RespuestasWorkspace.tsx` → `/api/reply-chat`

### AI Memory & Brand Kit
- Memory: `/api/reflect-memory`, `/api/synthesize-memory`, `memory-helpers.ts`
- Brand: `/api/extract-brand`, `brand-kit.ts`, `BrandKitSelector.tsx`

### Admin
- `AdminDashboard.tsx`, `AdminTickets.tsx`
- `/api/admin-billing`, `/api/admin-image-performance`

### Onboarding & feedback
- `OnboardingWizard.tsx`, `useOnboarding.ts`
- `FeedbackButton.tsx` → `feedback_tickets` table

## Styling
- Tailwind utility classes throughout
- Brand: `#0284c7` (primary-600 / sky-600)
- Dark theme: custom `dark-*` inverted palette
- Icons: Lucide React
- Fonts: Inter + Montserrat

## Deployment
- Vercel SPA rewrites in `vercel.json`
- CSP + security headers configured
- Function timeouts: 30s (transcribe) to 240s (carousel)
