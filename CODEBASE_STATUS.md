# Copywrite Codebase Status - Complete Change Log and Current State

Last updated: February 2025

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Data Flow: Form to Script Generation](#data-flow-form-to-script-generation)
3. [Database Schema](#database-schema)
4. [Form System](#form-system)
5. [Prompt System (Master Prompt Architecture)](#prompt-system-master-prompt-architecture)
6. [Recent Changes: Full Change Log](#recent-changes-full-change-log)
7. [File Reference: Current State](#file-reference-current-state)
8. [Known Issues and Pending Work](#known-issues-and-pending-work)

---

## Architecture Overview

The app is a sales script generator (Guiones) built with React + Vite frontend and a Vercel serverless API backend (`api/chat.ts`) that calls the Grok AI API. Users create a **Business** (negocio) and then add **Products/Services** under it. The AI generates video sales scripts based on structured business + product context.

```
User Flow:
  Create Business (BusinessForm) 
    -> Select Product Type (ProductTypeSelector)
      -> Fill Product/Service/Indumentaria/Restaurant/RealEstate Form
        -> Go to ProductWorkspace (Guiones)
          -> Configure: Consciousness Level, Sales Channel, Script Settings
            -> Generate Scripts via AI (Grok API)
              -> Edit/Enhance/Change Hooks on individual scripts
```

### Key directories

- `src/pages/` - Page components (Dashboard, ProductWorkspace, PostsDashboard, etc.)
- `src/components/` - Form components and UI components
- `src/services/` - Database CRUD (`database.ts`) and API client (`grokApi.ts`)
- `src/types/` - TypeScript interfaces and types
- `src/utils/` - Utilities (script parser, form auto-fill)
- `api/` - Serverless backend (Vercel functions)
- `supabase/migrations/` - Database migrations

---

## Data Flow: Form to Script Generation

### Step 1: Business Context (stored in `businesses` table)

`BusinessForm.tsx` collects:
- Business name
- Sales channels: `physical`, `messages`, `website` (multi-select)
- Location (optional)
- Shipping: yes/no + method
- Target audiences (multiple blocks): sex, age range, geographic scope, profession

### Step 2: Product Context (stored in `products` table with `business_id` FK)

One of 5 form types depending on `ProductType`:

| Type | Form | Steps | Key Fields |
|------|------|-------|------------|
| `product` | `ProductForm.tsx` | 9 | category, benefits, alternatives, variations, specs, utility, result, guarantee, price range, stock |
| `service` | `ServiceForm.tsx` | 8 | service type, problem, pain, alternatives, transformation, process, differentiation, objections, success cases |
| `indumentaria` | `IndumentariaForm.tsx` | 6 | article type, model count, variations, material, changes/guarantees, personalization, images |
| `restaurant` | `RestaurantForm.tsx` | 3 | menu (text/PDF), location, schedule, is_new |
| `real_estate` | `RealEstateForm.tsx` | 3 | business type (sale/rent/airbnb), price, location, rooms, highlights, CTA |

### Step 3: ProductWorkspace (Script Generation UI)

`ProductWorkspace.tsx` is where scripts are generated. Left sidebar controls:

1. **Script Settings** (`ScriptSettingsPanel`) - number of variations, generation mode
2. **Consciousness Level** - Cold / Warm / Hot (3-way toggle)
3. **Active Sales Channel** - Physical / Messages / Website (shows only channels the business configured)
4. **Instructions** - Free-text input + voice recording
5. **Generate Scripts** button
6. **Sessions** list

### Step 4: API Pipeline

```
ProductWorkspace.tsx
  -> buildProductContext(product, additionalContext)     [legacy context]
  -> getStructuredContexts(product)                      [new structured context]
     -> buildApiBusinessContext(product.business)         [from grokApi.ts]
     -> buildApiProductContext(product)                   [from grokApi.ts]
  -> sendMessageToGrok(messages, productContext, language, scriptSettings, ..., 
                       bizCtx, prodCtx, consciousnessLevel, activeSalesChannel)
     -> POST /api/chat with all context in body
```

### Step 5: Backend Prompt Assembly (`api/chat.ts`)

```
systemPrompt = basePrompt                    // Type-specific master prompt
             + businessRulesPrompt           // Channel/location/shipping/audience rules
             + productRulesPrompt            // Category/price/guarantee/method rules
             + consciousnessPrompt           // Cold/Warm/Hot awareness tuning
             + settingsPrompt                // Script count/type config
             + contextDocsPrompt             // PDFs/links/text documents
             + structuredContextPrompt       // Formatted business + product data
             + legacyContextPrompt           // Fallback JSON dump (backward compat)
```

---

## Database Schema

### `businesses` table
- `id` UUID PK
- `owner_id` UUID FK -> profiles
- `client_id` UUID FK -> clients (nullable, for team mode)
- `name` TEXT NOT NULL
- `sales_channels` TEXT[] NOT NULL ('physical', 'messages', 'website')
- `location` TEXT (nullable)
- `does_shipping` BOOLEAN DEFAULT false
- `shipping_method` TEXT (nullable)
- `created_at`, `updated_at` TIMESTAMPTZ

### `business_target_audiences` table
- `id` UUID PK
- `business_id` UUID FK -> businesses ON DELETE CASCADE
- `sex` TEXT ('male', 'female', 'both')
- `age_min` INT DEFAULT 18
- `age_max` INT DEFAULT 65
- `geographic_scope` TEXT ('local', 'country', 'world', 'custom')
- `geographic_scope_custom` TEXT (nullable)
- `has_specific_profession` BOOLEAN DEFAULT false
- `profession_description` TEXT (nullable)

### `products` table (extended)
- `business_id` UUID FK -> businesses (nullable for legacy products)
- `type` TEXT CHECK ('product', 'service', 'restaurant', 'real_estate', 'indumentaria')
- Product-specific columns: `product_category`, `current_alternatives`, `alternatives_disadvantages`, `product_variations[]`, `technical_specs`, `utility`, `result`, `has_guarantee`, `guarantee_details`, `price_range`, `stock_limited`
- Service-specific columns: `svc_service_type`, `svc_problem`, `svc_current_pain`, `svc_alternatives_tried`, `svc_alternatives_failures`, `svc_concrete_result`, `svc_result_timeline`, `svc_life_change`, `svc_process_steps`, `svc_service_format`, `svc_service_duration`, `svc_differentiation`, `svc_has_own_method`, `svc_method_name`, `svc_main_objection`, `svc_has_guarantee`, `svc_guarantee_details`, `svc_has_success_cases`
- Indumentaria-specific columns: `ind_article_type`, `ind_model_count`, `ind_variations_description`, `ind_sizes`, `ind_main_material`, `ind_quality_description`, `ind_accepts_changes`, `ind_change_policy`, `ind_customizable`, `ind_customization_description`, `ind_product_images[]`
- Restaurant: `menu_text`, `menu_pdf_url`, `location`, `schedule`, `is_new_restaurant`
- Real estate: `re_business_type`, `re_price`, `re_location`, `re_construction_size`, `re_bedrooms`, `re_capacity`, `re_bathrooms`, `re_parking`, `re_highlights`, `re_location_reference`, `re_cta`

### `service_success_cases` table
- `id` UUID PK
- `product_id` UUID FK -> products ON DELETE CASCADE
- `client_name`, `before_state`, `what_they_did`, `result`, `timeline`, `life_change`

### Migrations
- `038_business_context.sql` - Creates all new tables and columns
- `039_migrate_existing_products.sql` - Auto-creates default businesses for existing users, links orphaned products

---

## Form System

### Auto-Fill Feature

All forms integrate `AutoFillButtons.tsx` at Step 1. Users can:
1. **Paste a URL** - the system scrapes the page via `/api/fetch-url` and sends content to AI
2. **Paste text** - sends raw text to AI

The AI (`formAutoFill.ts`) has dedicated prompts per form type (`BUSINESS_PROMPT`, `SERVICE_PROMPT`, `INDUMENTARIA_PROMPT`, `RESTAURANT_PROMPT`, `PRODUCT_PROMPT`, `RE_PROMPT`) that instruct it to fill ALL fields and never leave any empty.

Each form's `onResult` handler maps the AI output to the form's state, including boolean fields and arrays.

### Form Type: `FormType = 'business' | 'service' | 'indumentaria' | 'restaurant' | 'product' | 'real_estate'`

---

## Prompt System (Master Prompt Architecture)

### Base Prompts (6 constants in `api/chat.ts`)

| Constant | Used When | Persona |
|----------|-----------|---------|
| `MASTER_PROMPTS` | Default / product type | Expert in Copywriting and Direct Sales Scripts, trained under MÉTODO IAN |
| `RESTAURANT_PROMPTS` | `type === 'restaurant'` | Expert in restaurant direct sale ads for short-form video |
| `REAL_ESTATE_PROMPTS` | `type === 'real_estate'` | Expert in Real Estate Video Marketing |
| `SERVICE_PROMPTS` | `type === 'service'` | Expert in Direct Sales Scripts for Services (B2B/B2C) |
| `INDUMENTARIA_PROMPTS` | `type === 'indumentaria'` | Expert in Direct Sales Scripts for Fashion/Apparel |
| `DESCRIPTION_PROMPTS` | `feature === 'description'` | Expert in product descriptions |

### `buildBusinessRulesPrompt(biz, language, activeSalesChannel)`

Generates rules based on the **active sales channel** selected in the workspace:

**Physical store selected:**
- Location in hook ONLY if audience geographic_scope is `local` or `custom` AND NOT `country`/`world`
- If audience is wide (country/world): location NOT in hook, only subtly in development
- Before CTA: mention how to get to the store
- CTA: "Los esperamos."
- Never use message or web CTAs

**Messages selected:**
- NEVER mention location in hook
- CTA: "Envíanos un mensaje para..."
- No physical or web CTAs

**Website selected:**
- NEVER mention location in hook
- CTA: "Dale click a este anuncio para hacer tu pedido."
- No physical or message CTAs

**No channel selected (fallback):**
- Safe multi-channel CTA logic (no forced location in hooks)

Also generates:
- Shipping rules (if does_shipping: mention logistics in development)
- Audience rules (sex, age range, geographic scope, profession)

### `buildProductRulesPrompt(product, language)`

Generates type-specific rules:

**Product:** category interpretation, price range (economico/medio/premium), guarantee, stock scarcity, variations
**Service:** own method as differentiator, guarantee to reduce objections, success cases as social proof
**Indumentaria:** model count (variety vs individual focus), customization as premium differentiator, accepts changes as trust builder

### `buildConsciousnessPrompt(level, language)`

| Level | Behavior |
|-------|----------|
| **Cold** | Viewer doesn't know they have the problem. Reveal problem, educate before selling, curiosity-driven hooks, "aha moments" |
| **Warm** | Viewer knows the problem, exploring solutions. Acknowledge pain, position as best solution, validate failed attempts, focus on differentiation |
| **Hot** | Viewer ready to buy. Be direct, lead with offer/specs, bullet-point format, social proof, urgency, clear CTA to buy now |

### `buildStructuredContext(biz, product, language)`

Formats all business and product data as labeled text (not raw JSON). Example:
```
Nombre del negocio: Clínica Vargas
Canales de venta: physical, messages
Ubicación: Escazú, San José
...
Nombre del producto/servicio: SmartDrive Pro
Tipo: product
Categoría: Tecnología
...
```

### Script Card Features (ScriptCard.tsx)

Each generated script has these actions:
1. **Copy** - copy to clipboard
2. **Save** - save to database
3. **Edit** (pencil icon) - free-text edit instruction sent to AI
4. **Magic Wand** (enhance) - predefined prompt that corrects script for direct-sale optimization
5. **+ Hooks** - dropdown of hook templates based on product type (product has 10 templates, indumentaria 9, service 8, restaurant 7, real estate 5)

Visual distinction for edit types:
- **Manual edit**: "Editado" badge in primary color
- **Magic wand**: "Mejorado" badge in amber with Wand2 icon
- **Hook change**: "Hook: [template name]" badge in blue with Anchor icon

Original content collapses to 2-line preview when edited version exists.

---

## Recent Changes: Full Change Log

### Change 1: Business Context Restructure (Major)

**What:** Separated business-level info from product-level info. Previously everything was in a single ProductForm with raw JSON dumped into the prompt.

**Files created:**
- `src/components/BusinessForm.tsx` (514 lines, 4-step wizard)
- `src/components/ServiceForm.tsx` (444 lines, 8-step wizard)
- `src/components/IndumentariaForm.tsx` (387 lines, 6-step wizard)
- `src/components/RealEstateForm.tsx` (262 lines, extracted from ProductForm)
- `src/components/ProductTypeSelector.tsx` (91 lines, 5-type modal)
- `supabase/migrations/038_business_context.sql` (178 lines)
- `supabase/migrations/039_migrate_existing_products.sql` (60 lines)

**Files rewritten:**
- `src/components/ProductForm.tsx` - stripped to product-type only (9 steps)
- `api/chat.ts` - added prompt builders, indumentaria prompt, structured context
- `src/services/grokApi.ts` - added `buildApiBusinessContext`, `buildApiProductContext`, businessContext/productContext params

**Files updated:**
- `src/types/index.ts` - new interfaces (Business, TargetAudience, SuccessCase, form data types), added 'indumentaria' to ProductType
- `src/services/database.ts` - CRUD for businesses, target audiences, success cases
- `src/pages/Dashboard.tsx` - business-first flow
- `src/pages/PostsDashboard.tsx` - business-first flow
- `src/pages/ProductWorkspace.tsx` - loads business context, shows business info in sidebar

### Change 2: Remove isTeamAccount Conditional

**What:** Removed the conditional that hid the business structure from non-team users. All users now have access to the business-to-product structure.

**Files changed:** `Dashboard.tsx`, `PostsDashboard.tsx`

### Change 3: Category -> Business Rename

**What:** Renamed UI elements from "Client"/"Category" to "Business"/"Negocio" throughout the dashboards.

**Files changed:** `Dashboard.tsx`, `PostsDashboard.tsx`, `BRollDashboard.tsx`, `DescriptionsDashboard.tsx`

### Change 4: Fix Missing Legacy Data

**What:** Previous businesses/products weren't showing after the restructure because database queries had filters that excluded legacy data.

**Fix:** 
- Removed `.is('client_id', null)` from `getBusinesses()` in `database.ts`
- Removed `.is('business_id', null)` from `getProducts()` in `database.ts`
- Added `getUnassignedProducts()` function

### Change 5: Fix ngrok Access

**What:** Vite was blocking ngrok hosts.

**Fix:** In `vite.config.ts`, set `server.allowedHosts: true` and `server.host: true`

### Change 6: Fix DOM Nesting Warning

**What:** `<button>` inside `<button>` in ProductWorkspace session list.

**Fix:** Changed outer `<button>` to `<div role="button" tabIndex={0}>` in `ProductWorkspace.tsx`

### Change 7: Remove Business Selection from ProductTypeSelector

**What:** The type selector had a redundant business selection section since the business is already selected before reaching the product form.

**Fix:** Stripped all business-related UI/logic from `ProductTypeSelector.tsx`

### Change 8: Business Info in Guiones Sidebar

**What:** Added business context display in the right sidebar of ProductWorkspace (name, sales channels, location, shipping, target audiences).

**Fix:** Added Business Info section before Product Info in `ProductWorkspace.tsx`

### Change 9: Context Documents Always Visible

**What:** The "Context Documents" section (links/PDFs) was only shown when a session was selected. Now shown always.

**Fix:** Removed conditional wrapper in `ProductWorkspace.tsx`

### Change 10: Magic Wand Feature

**What:** Added one-click script enhancement using a predefined optimization prompt.

**Fix:** Added `handleEnhance()` and `ENHANCE_PROMPT` constant in `ScriptCard.tsx`. Wand2 icon button in action bar.

### Change 11: + Hooks Feature

**What:** Added hook template picker dropdown per product type. Selecting a hook sends its prompt to the AI to rewrite the script with that hook style.

**Fix:** Added `getHookTemplates()`, `handleHookChange()`, and hook picker UI in `ScriptCard.tsx`. Templates differ by product type (product: 10, indumentaria: 9, service: 8, restaurant: 7, real estate: 5).

### Change 12: Script Edit Type Distinction

**What:** Added visual distinction between manual edits, magic wand enhancements, and hook changes.

**Fix:** Added `editSource` and `editSourceLabel` state in `ScriptCard.tsx`. Different badge colors/icons per type. Original content collapses when edit exists.

### Change 13: Fix + Hooks Dropdown Clipping

**What:** The hooks dropdown was hidden by `overflow-hidden` on the parent card div.

**Fix:** Removed `overflow-hidden` from ScriptCard's main div.

### Change 14: Consciousness Level Wiring

**What:** The consciousness level selector was cosmetic-only. Now wired end-to-end.

**Fix:**
- Added `consciousnessLevel` param to `sendMessageToGrok()` in `grokApi.ts`
- Added `consciousnessLevel` to `RequestBody` in `api/chat.ts`
- Created `buildConsciousnessPrompt()` with detailed cold/warm/hot instructions
- Integrated into system prompt assembly

### Change 15: AI Auto-Fill Improvements

**What:** Form auto-fill was leaving fields empty. Rewrote all AI prompts to be comprehensive.

**Fix:** 
- Rewrote prompts in `formAutoFill.ts` to explicitly instruct AI to fill ALL fields and infer if necessary
- Updated `onResult` handlers in all form components to correctly map booleans and arrays
- Created centralized `AutoFillButtons.tsx` component
- Refactored `ProductForm.tsx` and `RealEstateForm.tsx` to use centralized auto-fill

### Change 16: Sales Channel Selector (Latest)

**What:** Location was being forced into hooks regardless of sales channel. Added an "Active Sales Channel" selector to the workspace sidebar.

**Fix:**
- Added `activeSalesChannel` state in `ProductWorkspace.tsx`
- Added channel selector UI in left sidebar (between Consciousness Level and Instructions)
- Threaded through `grokApi.ts` to `api/chat.ts`
- Rewrote `buildBusinessRulesPrompt()` with channel-specific rules:
  - Physical: location in hook only if local audience, CTA "Los esperamos"
  - Messages: never location in hook, CTA "Envíanos un mensaje para..."
  - Website: never location in hook, CTA "Dale click a este anuncio..."

---

## File Reference: Current State

| File | Lines | Purpose |
|------|-------|---------|
| `api/chat.ts` | ~1568 | Backend prompt system, AI API call |
| `src/pages/ProductWorkspace.tsx` | ~1990 | Script generation workspace |
| `src/pages/Dashboard.tsx` | 752 | Main dashboard, business/product management |
| `src/pages/PostsDashboard.tsx` | 430 | Posts dashboard |
| `src/pages/BRollDashboard.tsx` | 337 | B-Roll dashboard |
| `src/pages/DescriptionsDashboard.tsx` | 297 | Descriptions dashboard |
| `src/services/database.ts` | 1181 | All Supabase CRUD operations |
| `src/services/grokApi.ts` | 317 | API client, context builders |
| `src/types/index.ts` | 525 | All TypeScript interfaces |
| `src/components/BusinessForm.tsx` | 514 | Business form (4 steps) |
| `src/components/ProductForm.tsx` | 452 | Product form (9 steps) |
| `src/components/ServiceForm.tsx` | 444 | Service form (8 steps) |
| `src/components/ScriptCard.tsx` | 443 | Script display with edit/enhance/hooks |
| `src/components/RestaurantForm.tsx` | 416 | Restaurant form (3 steps) |
| `src/components/IndumentariaForm.tsx` | 387 | Indumentaria form (6 steps) |
| `src/components/RealEstateForm.tsx` | 262 | Real estate form (3 steps) |
| `src/components/AutoFillButtons.tsx` | 175 | URL/text auto-fill buttons |
| `src/components/ProductTypeSelector.tsx` | 91 | 5-type product selector modal |
| `src/utils/formAutoFill.ts` | 236 | AI auto-fill prompts and logic |
| `supabase/migrations/038_business_context.sql` | 178 | Schema for businesses, audiences, success cases |
| `supabase/migrations/039_migrate_existing_products.sql` | 60 | Legacy data migration |

---

## Known Issues and Pending Work

### Testing Needed
- Verify the new Sales Channel selector properly controls script output (no location forced in hooks when Messages/Website selected)
- Test consciousness levels produce meaningfully different scripts
- Test auto-fill with various URLs and pasted text across all form types
- Verify legacy products (created before restructure) still work in all dashboards

### Configuration
- `vite.config.ts` has `server.allowedHosts: true` and `server.host: true` for ngrok access
- Grok API model: `grok-3-fast`

### Architecture Notes
- The system supports BOTH legacy (`businessDetails` JSON dump) and structured (`businessContext`/`productContext`) context paths. Structured is preferred when available.
- `buildProductContext()` in ProductWorkspace still sends legacy fields for backward compatibility with old products
- `getStructuredContexts()` builds the new structured context from `product.business` join
- The `products` table has many nullable columns because each product type only uses its own subset
