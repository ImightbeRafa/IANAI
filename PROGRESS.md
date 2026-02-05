# Advance AI - Development Progress

## Last Updated: February 5, 2026 at 5:44 PM (UTC-06:00)

---

## Project Overview

**Advance AI** (formerly CopywriteAI) is an AI-powered content creation platform. Features include:
- **Scripts**: High-conversion ad scripts for social media using Grok API
- **Posts**: AI-powered Instagram image generation using Flux, Gemini, and Grok Imagine APIs
- **B-Roll**: AI-powered video generation using Grok Imagine Video & Kling 2.6 Pro (via fal.ai)
- **ICP Profiles**: Ideal Customer Profile management for targeted script generation

---

## Architecture Restructure (Current Work)

### Previous Approach (DEPRECATED)
- AI conducted a 5-question interview through chat
- Users answered questions one by one in the chat
- AI generated scripts after collecting all answers

### New Approach (CURRENT)
- Users create Products/Services via a **form** with all business context
- Product context is stored in database and passed to AI automatically
- Chat is used **only** for script generation and refinement
- Users can provide additional context per session
- Feedback mechanism allows iterating on generated scripts

---

## Account Types

### 1. Single User (Individual)
**Hierarchy:**
```
User
└── Products/Services
    └── Chat Sessions (Script Generation)
        └── Generated Scripts
```

### 2. Team Account
**Hierarchy:**
```
Team
└── Clients
    └── Products/Services
        └── Chat Sessions (Script Generation)
            └── Generated Scripts
```

Teams can organize products/services under different clients for better management when handling multiple clients.

---

## UI Structure

### Dashboard
- **Single User**: Shows list of Products/Services
- **Team User**: Shows list of Clients, each expandable to show their Products/Services
- Stats cards showing: Total Products, Total Scripts, Total Sessions, Scripts This Month

### ProductWorkspace (Chat Interface)
```
+------------------+------------------------+-------------------+
|                  |                        |                   |
|  SESSION LIST    |      CHAT AREA         |   PRODUCT INFO    |
|  (Left Panel)    |      (Center)          |   (Right Panel)   |
|                  |                        |                   |
|  - New Session   |  Messages display      |  - Editable info  |
|  - Session 1     |  here with AI          |  - Description    |
|  - Session 2     |  responses             |  - Offer          |
|  - ...           |                        |  - Values         |
|                  |                        |                   |
|                  |  [Generate Script]     |  EXTRA CONTEXT    |
|                  |                        |  - Session-specific|
|                  |  [Input + Send]        |    context        |
|                  |                        |  - Feedback       |
+------------------+------------------------+-------------------+
```

---

## Database Schema

Using the NEW schema from `supabase/migrations/001_teams_restructure.sql`:

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (extends auth.users) |
| `teams` | Team accounts |
| `team_members` | Users belonging to teams |
| `clients` | Clients (team accounts only) |
| `products` | Products/Services with all business context |
| `chat_sessions` | Chat sessions per product |
| `messages` | Chat messages |
| `scripts` | Saved/generated scripts with ratings |
| `script_templates` | User-saved script templates (NEW) |

---

## Files Structure

### Active/Current Files
- `src/App.tsx` - Main router
- `src/pages/Dashboard.tsx` - Dashboard for both account types
- `src/pages/ProductWorkspace.tsx` - Main chat/script interface
- `src/pages/Login.tsx` - Login page
- `src/pages/Signup.tsx` - Signup page
- `src/pages/Settings.tsx` - User settings
- `src/components/Layout.tsx` - App layout with navigation
- `src/components/ProductForm.tsx` - Form for creating/editing products
- `src/components/ProtectedRoute.tsx` - Auth guard
- `src/components/ThinkingAnimation.tsx` - AI loading animation
- `src/components/ScriptSettingsPanel.tsx` - Script generation settings UI (NEW)
- `src/services/database.ts` - Supabase database functions
- `src/services/grokApi.ts` - Grok API integration
- `src/contexts/AuthContext.tsx` - Authentication context
- `src/contexts/LanguageContext.tsx` - i18n language context
- `src/types/index.ts` - TypeScript types
- `api/chat.ts` - Vercel serverless function for Grok API

### Removed (Feb 2, 2026)
- ~~`src/pages/Chat.tsx`~~ - DELETED (old interview-based chat)
- ~~`src/pages/History.tsx`~~ - DELETED (old conversation history)
- ~~`src/pages/Scripts.tsx`~~ - DELETED (old scripts page)

---

## Change Log

### February 2, 2026 - 12:08 PM (UTC-06:00)
- [x] Created PROGRESS.md for tracking
- [x] Fixed API parameter mismatch (`productContext` → `businessDetails`) in `src/services/grokApi.ts`
- [x] Updated `supabase/schema.sql` to use new teams/products structure (replaced old conversations schema)
- [x] Removed deprecated pages from codebase:
  - Deleted `src/pages/Chat.tsx` (old interview-based chat)
  - Deleted `src/pages/History.tsx` (old conversation history)
  - Deleted `src/pages/Scripts.tsx` (old scripts page)
- [x] Removed legacy types from `src/types/index.ts` (Conversation, BusinessDetails)
- [x] Updated `src/pages/ProductWorkspace.tsx` with proper 3-panel layout:
  - Left: Session list with New Session button
  - Center: Chat area with Generate Script button (empty state), messages, Save Script on AI responses
  - Right: Editable product info (all fields) + Additional Context section
- [x] Added script generation button with `Sparkles` icon
- [x] Added regenerate button with `RefreshCw` icon in input area
- [x] Added save script functionality with `BookmarkPlus` icon on AI messages
- [x] Added bilingual labels for all new features (ES/EN)
- [x] Dashboard already supports single users with "Upgrade to Team" option

### February 2, 2026 - 12:26 PM (UTC-06:00)
- [x] Updated sidebar menu in `src/components/Layout.tsx`:
  - Removed: New Script, History, My Scripts (old pages that no longer exist)
  - Kept: Dashboard, Settings
  - Added bilingual labels (ES/EN)
- [x] Created migration `supabase/migrations/002_make_all_accounts_team.sql`:
  - Updates all existing profiles to `account_type = 'team'`
  - Creates teams for users who don't have one
  - Adds owners as team admins

### February 3, 2026 - Team Account Features (AM Session)
- [x] Updated `Settings.tsx` to display account type (Team/Individual) with visual indicators
- [x] Revamped `Dashboard.tsx` for team accounts:
  - Client-based hierarchy view for team accounts
  - Create/manage clients functionality
  - "Unassigned Products" section for products without a client
  - Ability to assign orphaned products to clients
- [x] Added `assignProductToClient()` function to database service
- [x] Created migration `003_fix_rls_policies.sql` for RLS policy fixes

### February 3, 2026 - Script Enhancement Features (10:15 AM)
- [x] **Script Frameworks** - Added 5 copywriting frameworks:
  - Direct Sale, PAS (Problem-Agitate-Solution), AIDA, BAB (Before-After-Bridge), 4Ps
- [x] **Tone Controls** - 6 tone options:
  - Professional, Casual, Urgent, Humorous, Inspirational, Controversial
- [x] **Duration Options** - Script length presets:
  - 15s (~40 words), 30s (~80 words), 60s (~150 words), 90s (~220 words)
- [x] **Platform Targeting** - 8 platform-specific styles:
  - General, TikTok, Instagram, YouTube, Facebook, LinkedIn, TV, Radio
- [x] **A/B Variations** - Generate 1, 2, 3, or 5 script variations at once
- [x] **Script Rating** - Thumbs up/down buttons that:
  - Auto-save script when rated
  - Store rating (1-5) in database for feedback loop
  - Visual feedback showing rated state
- [x] Created `ScriptSettingsPanel.tsx` component with bilingual labels
- [x] Updated `api/chat.ts` with framework/tone/duration/platform prompts
- [x] Created migration `004_script_enhancements.sql`:
  - Added settings columns to `chat_sessions`
  - Added rating/versioning columns to `scripts`
  - Created `script_templates` table
  - Added `get_user_team_ids()` helper function
- [x] Added database functions: `rateScript()`, `getScriptVersions()`, `createScriptVersion()`
- [x] Made settings panel scrollable for smaller screens

### February 3, 2026 - New Product Form Fields & Info Panel (11:00 AM)
- [x] **Redesigned ProductForm** with new detailed questions:
  - **Products**: Description, main problem, best customers, failed attempts, attention grabber, expected result, differentiation, key objection, shipping info, awareness level
  - **Services**: Same base + real pain, pain consequences (instead of objection/shipping)
- [x] **Quick Paste Modal** - Paste raw client answers, AI organizes them into form fields
- [x] Updated `ProductWorkspace` info panel to display all new fields per type
- [x] Added edit mode for all new fields in ProductWorkspace
- [x] Created migration `006_new_form_fields.sql` with new columns
- [x] Updated `createProduct()` and `updateProduct()` in database.ts
- [x] Updated `buildProductContext()` to pass new fields to AI

### February 3, 2026 - Real Estate Product Type & Improved Service Prompts (11:56 AM)
- [x] **NEW Product Type: Real Estate** (`real_estate`)
  - Form fields: Business type (sale/rent/airbnb), price, location, construction size, bedrooms, capacity, bathrooms, parking, highlights, location reference, CTA
  - 3-step form for real estate (vs 5 steps for product/service)
  - Dedicated AI prompt for real estate scripts with price+location hooks
- [x] **Improved Service Prompts** with Ian methodology:
  - 5 angle variations: Authority, Process, Pain vs Solution, Educational/List, Irresistible Offer
  - Smart placeholders `[PLACEHOLDER]` for cases of success
  - Tangibilize intangibles with numbers, times, steps
- [x] **Updated Files:**
  - `src/types/index.ts` - Added `'real_estate'` to ProductType, real estate fields to Product and ProductFormData
  - `src/components/ProductForm.tsx` - 3-column type selector, real estate form steps 2-3
  - `src/pages/ProductWorkspace.tsx` - Real estate labels (ES/EN), view/edit fields, buildProductContext
  - `src/services/grokApi.ts` - Real estate fields in ProductContext
  - `src/services/database.ts` - Real estate fields in createProduct
  - `api/chat.ts` - `REAL_ESTATE_PROMPTS` and `SERVICE_PROMPTS`, handler selects prompt by type
  - `supabase/migrations/006_new_form_fields.sql` - Real estate columns added

### February 3, 2026 - Ian's 5 Master Structures Implementation (12:10 PM)
- [x] **MAJOR REFACTOR: Script Frameworks to Ian's 5 Master Structures**
  - Replaced old frameworks (direct, pas, aida, bab, fourp) with Ian's methodology
  - New structures based on "Ingeniería de Contenido para Venta Directa"
- [x] **The 5 Master Structures:**
  1. **Venta Directa (La Madre)** - For known demand products (iPads, Tech, Clothing)
  2. **Desvalidar Alternativas (El Posicionador)** - Position against generic competition
  3. **Mostrar el Servicio (Principio a Fin)** - Show service process step by step
  4. **Variedad de Productos (El Menú)** - Help undecided customers self-select
  5. **Paso a Paso (Complementario/Retargeting)** - Explain complex logistics
- [x] **Enhanced AI Prompts with Ian Methodology:**
  - "Certeza Total" philosophy - eliminate doubt, not convince
  - Tríada Estructural: Hook (0-3s) → Development (4-35s) → CTA (5s)
  - Zero greetings rule, no reiteration, logistics in development
  - Tangible value over abstract claims
- [x] **Updated Files:**
  - `src/types/index.ts` - New `ScriptFramework` type with 5 structures
  - `src/components/ScriptSettingsPanel.tsx` - New framework labels (ES/EN)
  - `src/services/grokApi.ts` - Default framework to `venta_directa`
  - `api/chat.ts` - Complete rewrite of `MASTER_PROMPTS` and `FRAMEWORK_PROMPTS`

### February 3, 2026 - TiloPay Integration Complete (3:34 PM)
- [x] **TiloPay Dashboard Configured**
  - Plan created in TiloPay Repeat API dashboard
  - Webhook URLs configured: `https://advanceai.studio/api/tilopay/webhook`
  - Redirect URLs configured for success/cancel flows
- [x] **Existing Users Granted Enterprise Access**
  - Migration `010_grant_existing_users_enterprise.sql` created
  - All existing test accounts will receive permanent enterprise plan
  - Enterprise plan = unlimited scripts/images (expires 2099)
- [x] **Environment Variables Required**
  - `TILOPAY_WEBHOOK_SECRET` - Get from TiloPay dashboard
  - `SUPABASE_SERVICE_ROLE_KEY` - Already configured

### February 3, 2026 - Admin Usage Dashboard (5:55 PM)
- [x] **Admin Dashboard for API Usage Tracking**
  - New page at `/admin` (only visible to admin emails)
  - Tracks all AI API calls with model, tokens, and costs
  - Shows total cost, total calls, success rate
  - Usage breakdown by model (Grok, Gemini, Flux, Nano Banana, Nano Banana Pro)
  - Usage breakdown by feature (Scripts, Images, Paste Auto-fill)
  - Daily trend chart
  - Recent activity log with all API calls
  - Date range filter (7d, 30d, 90d)
- [x] **Usage Logging System**
  - New `api_usage_logs` table with RLS policies
  - Logs: user, feature, model, tokens, estimated cost, success/failure
  - SQL functions: `get_usage_summary()`, `get_daily_usage()`
- [x] **Cost Estimation**
  - Grok: $3/1M input, $15/1M output tokens
  - Gemini: $0.15/1M input, $0.60/1M output tokens
  - Flux: ~$0.003/image
  - Nano Banana: ~$0.02/image
  - Nano Banana Pro: ~$0.05/image
- [x] **Files Created:**
  - `supabase/migrations/013_api_usage_logs.sql`
  - `api/lib/usage-logger.ts`
  - `src/pages/AdminDashboard.tsx`
- [x] **Files Updated:**
  - `api/chat.ts` - Added usage logging for Grok and Gemini
  - `api/generate-image.ts` - Added usage logging for Flux and Gemini image
  - `src/components/Layout.tsx` - Admin link in sidebar (admin only)
  - `src/App.tsx` - Added /admin route

### February 3, 2026 - Model Switching & TiloPay Fixes (5:30 PM)
- [x] **AI Model Switching for Scripts**
  - Toggle between **Grok** (xAI) and **Gemini 3 Pro** (Google) models
  - Same system prompts and context used for both models
  - UI selector in ScriptSettingsPanel (compact and full modes)
  - Added `AIModel` type: `'grok' | 'gemini'`
- [x] **AI Model Switching for Image Generation (Posts)**
  - **Nano Banana**: Gemini 2.5 Flash Image model
  - **Nano Banana Pro**: Gemini 3 Pro Image Preview model
  - UI selector in PostWorkspace with model descriptions
  - Added `ImageModel` type: `'flux' | 'nano-banana' | 'nano-banana-pro'`
- [x] **TiloPay Webhook Refactored**
  - Event-specific webhook URLs (subscribe, payment, rejected, unsubscribe, reactive)
  - Matches TiloPay Repeat API documentation
  - User matching via email in `pending_subscriptions` or `profiles` table
- [x] **Subscription Table Fix**
  - Migration `012_fix_subscriptions_unique.sql` adds UNIQUE constraint on `user_id`
  - Fixes upsert creating duplicate rows instead of updating
  - Removes duplicate subscriptions (keeps most recent)
- [x] **Auth Headers Fixed**
  - Added Authorization header to `grokApi.ts` for chat API calls
  - Added Authorization header to `ProductForm.tsx` for paste auto-fill
  - Added Authorization header to `PostWorkspace.tsx` for image generation
- [x] **Simplified Script Prompts**
  - Removed duration and framework from user-visible prompts
  - Now only shows "Generate X script(s)" in chat
- [x] **Files Updated:**
  - `api/chat.ts` - Gemini API integration, model selection
  - `api/generate-image.ts` - Gemini image models support
  - `api/tilopay/webhook.ts` - Event-specific webhook handling
  - `src/types/index.ts` - AIModel, ImageModel types
  - `src/components/ScriptSettingsPanel.tsx` - Model selector UI
  - `src/pages/PostWorkspace.tsx` - Image model selector, auth header
  - `src/pages/ProductWorkspace.tsx` - Simplified prompts
  - `src/services/grokApi.ts` - Auth header, default model
  - `src/components/ProductForm.tsx` - Auth header for paste feature
- [x] **New Files:**
  - `supabase/migrations/012_fix_subscriptions_unique.sql`
- [x] **Environment Variables Required:**
  - `GEMINI_API_KEY` - For Gemini text and image generation

### February 5, 2026 - Kling 2.6 Pro via fal.ai & Usage Tracking Overhaul (5:44 PM)
- [x] **MAJOR: Kling AI Video Generation via fal.ai**
  - Migrated from direct Kling API + JWT auth to fal.ai client
  - Uses `@fal-ai/client` package (fal.queue.submit / fal.queue.status / fal.queue.result)
  - Models: `fal-ai/kling-video/v2.6/pro/text-to-video` and `fal-ai/kling-video/v2.6/pro/image-to-video`
  - Duration: 5-30 seconds in 5s increments
  - Prompt limit: 3000 chars (condensed via grok-3-mini if motherPrompt exceeds)
  - Task ID format: `modelId::requestId` (double colon separator)
  - Pricing: $0.07/sec (no audio), $0.14/sec (with audio)
  - Auth: single `FAL_KEY` env var (removed KLING_ACCESS_KEY/SECRET_KEY and JWT generation)
  - Removed `jsonwebtoken` dependency entirely
- [x] **B-Roll Ad Prompt Pipeline (Module A+B+C)**
  - New `api/build-ad-prompt.ts` endpoint implementing 3-module pipeline:
    - Module A: Visual DNA Processor (product photos → visual identity)
    - Module B: Cinematic Script Transformer (script → shot-by-shot breakdown)
    - Module C: Mother Prompt Fusion (Visual DNA + Cinematic Script → final video prompt)
  - Modules A+B run in parallel for reduced latency
  - Output capped at 3000 chars to fit video API limits
  - Uses grok-3-mini for all three modules
- [x] **Frontend: Dual Video Model Support**
  - Model selector: Kling 2.6 Pro (fal.ai) vs Grok (xAI)
  - Kling mode selector: Standard vs Professional with bilingual descriptions
    - Estándar: "Rápido, buena calidad. Ideal para borradores y pruebas."
    - Profesional: "Máxima calidad y coherencia visual. Ideal para entrega final."
  - Duration slider: both models 5-30s (Kling steps by 5, Grok steps by 1)
  - Script paste textarea replaces script selector dropdown
  - Prompt preview auto-shows when mother prompt is built
  - Generate button hidden until motherPrompt is set
- [x] **Usage Tracking Overhaul**
  - Added `grok-3-mini` to MODEL_COSTS ($0.30/1M in, $0.50/1M out)
  - Added Kling fal.ai model cost entries ($0.07/sec per model)
  - Added `prompt_condense` feature type for tracking condense calls
  - Both video endpoints now log condense usage separately
  - All endpoints now log both success AND failure (fixed missing error logs)
  - Fixed Grok video error log using wrong model string (was `grok-imagine-video`, now uses resolution-based string)
- [x] **Admin Dashboard Updates**
  - Added all Kling fal.ai models to MODEL_INFO with display names + colors
  - Added `grok-3-mini`, `grok-imagine-video-480p`, `grok-imagine-video-720p` to MODEL_INFO
  - Added all new models to MODEL_PRICING reference display
  - Added `kling_video`, `ad_prompt_build`, `prompt_condense` to bilingual feature labels
  - Added feature icons for all new feature types
- [x] **Proxy Video Domain Updates**
  - Added `.fal.media`, `.fal.ai`, `.fal.run` to allowed download domains
  - Updated comment from "xAI video URL" to "video URL domain"
- [x] **New Files Created:**
  - `api/build-ad-prompt.ts` - 3-module ad prompt pipeline
  - `api/generate-video-kling.ts` - Kling video generation via fal.ai
- [x] **Files Updated:**
  - `api/generate-video.ts` - Added prompt condense logging, fixed error model string
  - `api/proxy-video.ts` - Added fal.ai domains
  - `api/lib/usage-logger.ts` - Added grok-3-mini, Kling costs, prompt_condense feature
  - `src/pages/BRollWorkspace.tsx` - Dual model UI, ad prompt pipeline, script paste
  - `src/pages/AdminDashboard.tsx` - All new models/features/labels/icons
- [x] **Dependencies:**
  - Added: `@fal-ai/client`
  - Removed: `jsonwebtoken`, `@types/jsonwebtoken`
- [x] **Environment Variables:**
  - Added: `FAL_KEY` (fal.ai API key)
  - Removed: `KLING_ACCESS_KEY`, `KLING_SECRET_KEY` (no longer needed)

### February 5, 2026 - ICP Profiles Feature (Earlier)
- [x] **NEW FEATURE: ICP (Ideal Customer Profile) Management**
  - Database: `icps` table with fields: name, description, awareness_level, sophistication_level, urgency_type, gender, age_range
  - Schema file: `supabase/icp-schema.sql`
  - Types: ICP and ICPFormData in `src/types/index.ts`
  - Pages: `ICPDashboard.tsx` (list), `ICPForm.tsx` (create/edit)
  - Routes: /icps, /icps/new, /icps/:icpId/edit
  - Sidebar: Added "Perfiles ICP" / "ICP Profiles" with Users icon
  - Database functions: getICPs, getICP, createICP, updateICP, deleteICP
  - ICP interpretation rules for AI:
    - awareness_level: Controls how to start messages (symptoms vs solutions)
    - sophistication_level: Controls claim aggressiveness (simple vs precise language)
    - urgency_type: Controls CTA directness and message rhythm
    - gender/age_range: Adjust vocabulary and examples

### February 5, 2026 - Team Management, PDF Upload & API Usage Tracking (6:30 AM)
- [x] **NEW FEATURE: Team Management Page**
  - New page at `/team` for managing team members
  - Invite new members by email (must be registered first)
  - Remove team members (owner only)
  - View all members with roles (Owner, Admin, Member)
  - Role icons: Crown (owner), Shield (admin), User (member)
  - Link added to Settings page for team accounts
- [x] **NEW FEATURE: PDF Upload for Context Documents**
  - Upload PDF files as context documents in ProductWorkspace (Guiones)
  - PDF text extraction via new API endpoint `/api/extract-pdf`
  - Supports files up to 10MB
  - Extracted text saved to database as `pdf` type document
  - UI: PDF upload button alongside Link button in context documents section
- [x] **NEW FEATURE: Google Sign-In on Login Page**
  - Added Google OAuth login button to Login page (was only on Signup)
  - Same styling as Signup page Google button
- [x] **NEW FEATURE: Delete Functionality**
  - Delete clients with all associated products, scripts, and data (owner only)
  - Delete products with all associated scripts and data
  - Confirmation dialogs in both Spanish and English
  - Delete buttons appear on hover for clients and products in Dashboard
- [x] **ENHANCED: API Usage Tracking**
  - Added tracking for PDF extraction (`pdf_extract` feature)
  - Added tracking for URL fetching (`url_fetch` feature)
  - Fixed prompt enhancement to use `prompt_enhance` feature (was using `script`)
  - New models in Admin Dashboard: PDF Parser, Web Scraper
  - New feature labels: Prompt Enhancement, PDF Extraction, URL Fetching
  - Icons added for all feature types in Admin Dashboard
- [x] **New Files Created:**
  - `src/pages/TeamManagement.tsx` - Team member management page
  - `api/extract-pdf.ts` - PDF text extraction API endpoint
  - `api/fetch-url.ts` - URL content fetching API endpoint
- [x] **Files Updated:**
  - `src/pages/Login.tsx` - Added Google sign-in button
  - `src/pages/Settings.tsx` - Added link to Team Management page
  - `src/pages/Dashboard.tsx` - Added delete buttons for clients and products
  - `src/pages/ProductWorkspace.tsx` - Added PDF upload UI and handler
  - `src/pages/AdminDashboard.tsx` - New feature types and icons
  - `src/App.tsx` - Added `/team` route
  - `api/enhance-prompt.ts` - Changed feature type to `prompt_enhance`
  - `api/lib/usage-logger.ts` - Added new feature types
  - `package.json` - Added `pdf-parse` dependency

### February 4, 2026 - B-Roll Video Generation & Grok Imagine (5:15 PM)
- [x] **NEW FEATURE: B-Roll Video Generation**
  - AI-powered video generation using Grok Imagine Video API
  - Generate short B-Roll clips from text prompts
  - Generate videos from existing images (image-to-video)
  - Support for multiple aspect ratios: 16:9, 4:3, 1:1, 9:16, 3:4, 3:2, 2:3
  - Support for resolutions: 720p, 480p
  - Duration options: 5 seconds (default)
  - Async polling pattern for video generation (videos take time)
- [x] **NEW FEATURE: Grok Imagine Image Model**
  - Added Grok Imagine as third image generation option alongside Flux and Gemini
  - Uses xAI's image generation API at `https://api.x.ai/v1/images/generations`
  - Cost tracking: ~$0.07 per image
- [x] **NEW FEATURE: Prompt Enhancement with AI**
  - "Mejorar con IA" / "Enhance with AI" button next to prompt textarea
  - Takes simple user prompts and enhances them for better AI generation
  - Separate enhancement prompts for images vs videos
  - Focuses on social media marketing context
  - Usage tracked in admin dashboard under `grok` model with `action: enhance_prompt`
- [x] **Beta Badges on Sidebar Navigation**
  - Small "beta" badges added to Guiones, Posts, and B-Roll nav items
  - Subtle styling to indicate features in beta
- [x] **Removed Auto-Generated Prompts**
  - PostWorkspace and BRollWorkspace no longer auto-fill prompts
  - Users write their own prompts and use "Enhance with AI" to improve them
- [x] **New Files Created:**
  - `api/generate-video.ts` - Grok Imagine Video API endpoint
  - `api/enhance-prompt.ts` - AI prompt enhancement endpoint
  - `src/pages/BRollDashboard.tsx` - Product selection for B-Roll
  - `src/pages/BRollWorkspace.tsx` - Video generation interface
  - `supabase/migrations/015_videos_and_usage.sql` - Videos table and usage tracking
- [x] **Files Updated:**
  - `src/types/index.ts` - Added `VideoModel`, `AspectRatio`, `VideoResolution` types, extended `ImageModel`
  - `api/generate-image.ts` - Added Grok Imagine support
  - `api/lib/auth.ts` - Added video support to usage limits
  - `api/lib/usage-logger.ts` - Added video and Grok Imagine cost tracking
  - `src/pages/PostWorkspace.tsx` - Grok Imagine option, prompt enhancement UI
  - `src/pages/AdminDashboard.tsx` - Grok Imagine and Video pricing info
  - `src/components/Layout.tsx` - B-Roll nav item, beta badges
  - `src/App.tsx` - B-Roll routes
  - `src/services/database.ts` - Added model parameter to createPost
- [x] **Bug Fixes:**
  - Fixed BRollDashboard not loading products for team accounts
  - Fixed Grok Video API URL (was `/video/` should be `/videos/`)
  - Fixed environment variable name (`XAI_API_KEY` → `GROK_API_KEY`)
- [x] **Environment Variables:**
  - `GROK_API_KEY` - For Grok chat, image, and video generation (xAI)

### February 3, 2026 - TiloPay Hardening & Script Settings Simplification (3:45 PM)
- [x] **Script Settings Simplified**
  - Removed framework/structure options (were limiting script quality)
  - Removed duration options
  - Now only shows "How many scripts?" (1, 2, 3, or 5 variations)
  - Cleaner UI with prominent generate button
- [x] **TiloPay Webhook Security Hardened**
  - Implemented proper HMAC-SHA256 signature verification
  - Uses `hash-tilopay` header as per TiloPay Repeat API
  - Timing-safe comparison to prevent timing attacks
  - Strict validation - rejects unsigned webhooks in production
- [x] **Billing Dashboard Added**
  - New billing section in Settings page
  - Shows current plan (Free, Starter, Pro, Enterprise)
  - Displays usage stats (scripts/images generated this month)
  - Plan upgrade buttons (TiloPay checkout integration ready)
  - Pricing in CRC (Costa Rican Colones)
- [x] **Webhook Test Script**
  - Created `scripts/test-tilopay-webhook.js`
  - Tests signature generation and verification locally
  - Can send live test webhooks to dev server
  - Run: `node scripts/test-tilopay-webhook.js --live`
- [x] **Files Updated:**
  - `src/components/ScriptSettingsPanel.tsx` - Simplified to variations only
  - `api/tilopay/webhook.ts` - HMAC-SHA256 verification
  - `src/pages/Settings.tsx` - Added billing section
- [x] **New Files:**
  - `scripts/test-tilopay-webhook.js` - Webhook testing utility

### February 3, 2026 - Security Audit & Payment Preparation (3:15 PM)
- [x] **Comprehensive Security Audit**
  - Created `SECURITY_AUDIT.md` documenting all findings
  - RLS policies verified for proper team data isolation
  - Identified and addressed API endpoint vulnerabilities
- [x] **Enhanced Registration Form**
  - Added Google OAuth sign-in via Supabase
  - Strong password requirements (8+ chars, uppercase, lowercase, number)
  - Password visibility toggle
  - Confirm password field with validation
  - Terms of service acceptance checkbox
  - Spanish language UI
- [x] **Server-Side API Authentication**
  - Created `api/lib/auth.ts` with auth verification utilities
  - Added JWT token verification to `/api/chat.ts`
  - Added JWT token verification to `/api/generate-image.ts`
  - Usage limit checking per user plan
  - Usage tracking increments on successful operations
- [x] **Subscriptions & Usage System**
  - New migration `009_subscriptions_and_usage.sql`
  - Tables: `subscriptions`, `usage`, `payments`, `plan_limits`
  - Plans: free, starter, pro, enterprise with defined limits
  - Auto-create free subscription on signup
  - Helper functions: `check_usage_limit()`, `increment_usage()`
- [x] **Tilo Pay Integration Preparation**
  - Created `api/tilopay/webhook.ts` with GET/POST handlers
  - Webhook signature verification (placeholder for Tilo Pay docs)
  - Event handlers for: payment.succeeded, payment.failed, subscription.created/updated/cancelled
  - Idempotent payment recording
- [x] **New Files Created:**
  - `SECURITY_AUDIT.md` - Security findings and recommendations
  - `api/lib/auth.ts` - Auth verification utilities
  - `api/tilopay/webhook.ts` - Tilo Pay webhook endpoint
  - `supabase/migrations/009_subscriptions_and_usage.sql` - Subscription tables
- [x] **Updated Files:**
  - `src/pages/Signup.tsx` - Complete form overhaul
  - `src/contexts/AuthContext.tsx` - Added `signInWithGoogle` method
  - `api/chat.ts` - Auth verification + usage limits
  - `api/generate-image.ts` - Auth verification + usage limits

### February 3, 2026 - AI Image Posts Prompt Improvements (2:35 PM)
- [x] **System Prompt Enhancement (Spanish Primary)**
  - System prompt now in Spanish as primary language
  - Instructs Flux to create clean product photos, NOT Instagram UI mockups
  - Explicitly forbids text/watermarks/logos in generated images
- [x] **Text Request Handling**
  - Detects when users request text in images (e.g., "que diga", "font", "con texto")
  - Automatically removes text instructions (AI can't render readable text)
  - Shows amber warning to user explaining limitation
  - Suggests using Canva/Photoshop for text overlay
- [x] **Updated Files:**
  - `api/generate-image.ts` - Spanish system prompt, text detection/cleaning
  - `src/pages/PostWorkspace.tsx` - Text warning UI with bilingual labels

### February 3, 2026 - AI Image Posts Feature (2:30 PM)
- [x] **NEW FEATURE: Instagram Post Image Generation**
  - AI-powered image generation using Flux 2 Klein API (BFL)
  - Supports img2img with up to 4 reference images
  - Multiple aspect ratios: Square (1:1), Portrait (4:5), Story (9:16)
  - Product context auto-fills prompt for better results
- [x] **Sidebar Navigation Update**
  - Renamed "Panel/Dashboard" to "Guiones/Scripts"
  - Added new "Posts" section with ImageIcon
  - Both sections share same client/product structure
- [x] **New Files Created:**
  - `api/generate-image.ts` - Vercel serverless function for Flux API
  - `src/pages/PostsDashboard.tsx` - Product list for post generation
  - `src/pages/PostWorkspace.tsx` - Image generation interface
  - `supabase/migrations/008_posts_table.sql` - Database table for posts
- [x] **Database Changes:**
  - New `posts` table with RLS policies
  - Stores prompts, input images, generated URLs, status
  - Linked to products via `product_id`
- [x] **Security:**
  - `BFL_API_KEY` stored as environment variable
  - API key never exposed to client
  - Async polling pattern for image generation
- [x] **Updated Files:**
  - `src/components/Layout.tsx` - New sidebar navigation
  - `src/App.tsx` - Added /posts and /posts/product/:id routes
  - `src/services/database.ts` - Post CRUD functions

### February 3, 2026 - Signup Flow & Branding Updates (2:06 PM)
- [x] **Signup Email Verification Message**
  - Shows success screen after signup instead of navigating to dashboard
  - Displays "Check your email" with user's email address
  - Amber warning box to check spam/junk folder
- [x] **Auto Team Account Creation**
  - New migration `007_auto_team_on_signup.sql`
  - Updated `handle_new_user()` trigger to create `account_type = 'team'`
  - Auto-creates team named "{Name}'s Team" for new users
  - Adds user as team owner automatically
- [x] **Removed Internal Branding**
  - Replaced "Metodología Ian" with "Copywriting de Alta Conversión" (ES)
  - Replaced "Ian Methodology" with "High-Conversion Copywriting" (EN)
  - Removed "Método Ian" references from hero subtitles
- [x] **Updated Files:**
  - `src/pages/Signup.tsx` - Email verification success state
  - `supabase/migrations/007_auto_team_on_signup.sql` - Auto team creation
  - `supabase/schema.sql` - Updated handle_new_user function
  - `src/pages/Home.tsx` - Removed Ian methodology references

### February 3, 2026 - Rebranding & Home Page (1:07 PM)
- [x] **REBRANDING: CopywriteAI → Advance AI**
  - Updated all references across the application
  - New logo with rounded corners (`rounded-xl`)
  - Brand styling: Montserrat font, italic, `#0284c7` (sky-600) color
- [x] **NEW: Home/Landing Page** (`src/pages/Home.tsx`)
  - Modern, professional design with light theme
  - Sections: Navigation, Hero, Stats, Features, How it Works, Pricing, Testimonials, CTA, Footer
  - Bilingual support (ES/EN)
  - Pricing displayed: $30/month (Single), $400/month (Teams up to 5)
- [x] **Light Theme Implementation**
  - Home page uses white/light backgrounds
  - Proper contrast with `dark-600`, `dark-900` text colors
  - Primary color accents (`primary-600`, `primary-100`)
- [x] **Updated Files:**
  - `src/pages/Home.tsx` - New landing page with light theme
  - `src/pages/Login.tsx` - Advance AI branding, rounded logo
  - `src/pages/Signup.tsx` - Advance AI branding, rounded logo
  - `src/App.tsx` - Added Home route, redirects to `/` by default
  - `index.html` - Updated title and favicon to Advance AI

---

## Ian's Content Engineering Methodology

### Philosophy: "Total Certainty"
The main problem with social media sales is NOT the price, it's **friction from distrust**. Videos shouldn't "try to convince" but **eliminate doubt** through precise description of reality.

### Key Principles
1. **Product > Marketing** - Best marketing is having an excellent product and simply describing it
2. **Tangible Value** - Clarity about what is received must exceed fear of losing money
3. **Zero Greetings Rule** - 2 seconds of attention credit, don't waste on "Hello"

### The Structural Triad
| Section | Duration | Function |
|---------|----------|----------|
| **Hook** | 0-3 sec | Filter and segment - attract wallets, not everyone |
| **Development** | 4-35 sec | Generate certainty and clarity with logistics |
| **CTA** | Last 5 sec | Cold, dry, direct navigation instruction |

### The 5 Master Structures

| Structure | Spanish Name | Ideal For | Formula |
|-----------|--------------|-----------|---------|
| **Direct Sale** | Venta Directa (La Madre) | Known demand products | Hook + Price Justification + Guarantee + Logistics + CTA |
| **Invalidate Alternatives** | Desvalidar Alternativas (Posicionador) | Superior to competition | "Don't buy X without knowing this" + 3 Defects + 3 Opposite Benefits + CTA |
| **Show Service** | Mostrar el Servicio | Aesthetics, Health, Processes | Service Name + Step 1,2,3 + Result + Assessment CTA |
| **Product Variety** | Variedad de Productos (El Menú) | Varied stock stores | "3 types you need to know" + Option A,B,C + Logistics + CTA |
| **Step by Step** | Paso a Paso (Retargeting) | Complex logistics | "Order in 3 steps" + Step 1,2,3 + CTA |

---

## Product Types

### 1. Product (Physical)
Form fields: name, description, main problem, best customers, failed attempts, attention grabber, expected result, differentiation, key objection, shipping info, awareness level

### 2. Service
Form fields: name, description, main problem, best customers, failed attempts, attention grabber, real pain, pain consequences, expected result, differentiation, awareness level

### 3. Restaurant
Form fields: name, menu text, location, schedule, is new restaurant

### 4. Real Estate (NEW)
Form fields: name, business type (sale/rent/airbnb), price, location, construction size, bedrooms, capacity, bathrooms, parking, highlights, location reference, CTA

---

## TODO / Next Steps

### Completed ✅
- [x] Team Dashboard UI - Client hierarchy, create/manage clients
- [x] ~~Script Frameworks (PAS, AIDA, BAB, 4Ps)~~ → Replaced with Ian's 5 Master Structures
- [x] Tone/Style Controls
- [x] Duration/Platform Options
- [x] A/B Variations (1-5 scripts)
- [x] Script Rating (feedback loop)
- [x] New detailed product/service form fields
- [x] Quick Paste modal with AI organization
- [x] Real Estate product type with dedicated form
- [x] Improved Service prompts with placeholders
- [x] **Ian's 5 Master Structures** - Venta Directa, Desvalidar Alternativas, Mostrar Servicio, Variedad, Paso a Paso
- [x] **Ian Methodology in AI Prompts** - Certeza Total philosophy, Tríada Estructural, Zero Greetings Rule

### Recently Completed ✅
1. ~~**Team Member Management**~~ - Invite/remove team members, view roles ✓
2. ~~**PDF Upload for Context**~~ - Upload PDFs as context documents in Guiones ✓
3. ~~**Google Login**~~ - Added to login page (was only on signup) ✓
4. ~~**Delete Functionality**~~ - Delete clients/products with confirmation ✓
5. ~~**API Usage Tracking**~~ - Track PDF extraction, URL fetch, prompt enhance ✓
6. ~~**ICP Profiles**~~ - Ideal Customer Profile management ✓
7. ~~**B-Roll Ad Prompt Pipeline**~~ - 3-module pipeline (Visual DNA + Cinematic Script + Mother Prompt) ✓
8. ~~**Kling 2.6 Pro via fal.ai**~~ - Dual video model support (Grok + Kling) ✓
9. ~~**Usage Tracking Overhaul**~~ - All features tracked with accurate pricing ✓

### High Priority
1. **Script Library Page** - Dedicated page to view all saved scripts with filters
2. **ICP Integration in Scripts** - Use ICP profiles to customize script generation prompts
3. **Audio Support for Kling** - Enable audio generation ($0.14/sec) with toggle

### Medium Priority
4. **AI Feedback Loop** - Use highly-rated scripts as examples for better generation
5. **Script Export** - Export scripts as PDF/TXT/Copy to clipboard
6. **Toast Notifications** - User feedback for save/rate actions

### Low Priority / Future
7. **Subscription/Billing** - Paid plans with usage limits
8. **Analytics** - Track script performance/engagement
9. **Templates Marketplace** - Share/sell script templates

---

## Testing Steps

### 1. Apply Database Migration (006 - Real Estate)
Run this in your Supabase SQL Editor to add real estate columns:
```sql
-- Add new form fields to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS product_description TEXT,
ADD COLUMN IF NOT EXISTS main_problem TEXT,
ADD COLUMN IF NOT EXISTS best_customers TEXT,
ADD COLUMN IF NOT EXISTS failed_attempts TEXT,
ADD COLUMN IF NOT EXISTS attention_grabber TEXT,
ADD COLUMN IF NOT EXISTS real_pain TEXT,
ADD COLUMN IF NOT EXISTS pain_consequences TEXT,
ADD COLUMN IF NOT EXISTS expected_result TEXT,
ADD COLUMN IF NOT EXISTS differentiation TEXT,
ADD COLUMN IF NOT EXISTS key_objection TEXT,
ADD COLUMN IF NOT EXISTS shipping_info TEXT;

-- Add real estate specific fields
ALTER TABLE products
ADD COLUMN IF NOT EXISTS re_business_type TEXT,
ADD COLUMN IF NOT EXISTS re_price TEXT,
ADD COLUMN IF NOT EXISTS re_location TEXT,
ADD COLUMN IF NOT EXISTS re_construction_size TEXT,
ADD COLUMN IF NOT EXISTS re_bedrooms TEXT,
ADD COLUMN IF NOT EXISTS re_capacity TEXT,
ADD COLUMN IF NOT EXISTS re_bathrooms TEXT,
ADD COLUMN IF NOT EXISTS re_parking TEXT,
ADD COLUMN IF NOT EXISTS re_highlights TEXT,
ADD COLUMN IF NOT EXISTS re_location_reference TEXT,
ADD COLUMN IF NOT EXISTS re_cta TEXT;

-- Create index for faster queries on product type
CREATE INDEX IF NOT EXISTS idx_products_owner_type ON products(owner_id, type);
```

### 2. Previous Migration (Profiles to Team)
Run this in your Supabase SQL Editor:
```sql
-- First, check current state
SELECT id, email, account_type FROM profiles;

-- Then run the migration
UPDATE profiles 
SET account_type = 'team', updated_at = NOW()
WHERE account_type = 'single';

-- Create teams for users who don't have one
INSERT INTO teams (name, owner_id)
SELECT 
  COALESCE(p.full_name, p.email) || '''s Team' as name,
  p.id as owner_id
FROM profiles p
WHERE p.account_type = 'team'
  AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.owner_id = p.id);

-- Verify
SELECT * FROM profiles;
SELECT * FROM teams;
```

### 2. Start Dev Server
```bash
npm run dev
```

### 3. Test New Workflow
1. Login to existing account (should now be team type)
2. Go to Dashboard - verify clean sidebar (only Dashboard + Settings)
3. Create a new Product/Service using the form
4. Navigate to the product workspace
5. Click "Generate Script" button
6. Verify AI generates 5 scripts
7. Test "Save Script" button on AI response
8. Test "Regenerate" button
9. Edit product info in right panel
10. Add session context and save

### 4. Verify Database
In Supabase dashboard, check:
- `profiles` table has `account_type = 'team'`
- `products` table has your new products
- `chat_sessions` has new sessions
- `messages` has chat messages
- `scripts` has saved scripts (if you saved any)

---

## API Notes

### Grok API Endpoint
- URL: `https://api.x.ai/v1/chat/completions`
- Model: `grok-4-1-fast-reasoning`
- The system prompt includes Ian's copywriting methodology with examples

### Request Body
```json
{
  "messages": [...],
  "businessDetails": { ... product context ... },
  "language": "en" | "es"
}
```

---

## Environment Variables

```
# Frontend (exposed to browser)
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key

# Backend (server-side only - Vercel)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GROK_API_KEY=your_xai_api_key          # For Grok chat, images, and videos
GEMINI_API_KEY=your_gemini_api_key     # For Gemini text and image generation
BFL_API_KEY=your_bfl_api_key           # For Flux image generation
FAL_KEY=your_fal_ai_key                # For Kling video generation via fal.ai
TILOPAY_WEBHOOK_SECRET=your_secret     # For payment webhooks
```
