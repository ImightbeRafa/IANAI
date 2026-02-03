# Advance AI - Development Progress

## Last Updated: February 3, 2026 at 3:45 PM (UTC-06:00)

---

## Project Overview

**Advance AI** (formerly CopywriteAI) is an AI-powered content creation platform. Features include:
- **Scripts**: High-conversion ad scripts for social media using Grok API
- **Posts**: AI-powered Instagram image generation using Flux 2 Klein API

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

### High Priority
1. **Team Member Management** - Invite team members, assign roles
2. **Script Library Page** - Dedicated page to view all saved scripts with filters
3. **Run Migration 006** - Add real estate columns to database

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
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
GROK_API_KEY=your_grok_api_key (server-side only)
```
