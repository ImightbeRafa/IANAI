# Guiones Pipeline Review

Purpose: make the guiones system generate scripts that are easier to turn into winners. The goal is not to make prompts longer. The goal is to make the pipeline smarter, sharper, less repetitive, easier to tune, and reliable across every category: venta directa, desvalidar alternativas, mostrar servicio, variedad, paso a paso, reconocimiento, organico, product, service, restaurant, real estate, and indumentaria.

This file is written for other agents reviewing the system. It documents how the current pipeline works, what is likely making the AI dumber, and what should change.

## Executive Summary

The current script-generation pipeline works, but it is mostly a "big prompt concatenator". The frontend collects product/business/settings, sends them to `api/chat.ts`, and the backend builds one large system prompt by stacking:

1. A master/category prompt.
2. business CTA/location rules.
3. product rules.
4. winning-script DNA rules.
5. AI memory.
6. brand voice.
7. saved script templates.
8. organic overrides.
9. CTA strength rules.
10. quantity/type instructions.
11. uploaded context documents.
12. structured product/business data.

This produces two big problems:

- The model gets many overlapping rules but no explicit planning step. It is told to "vary hooks", but it is not forced to first choose different angles, objections, buyer awareness levels, or proof mechanisms.
- Category behavior is inconsistent. Some product types have bespoke prompts that hard-code counts or angles, while the shared settings layer asks for different counts/types. This creates conflict and makes tuning unpredictable.

The biggest improvement is to split generation into a real pipeline:

1. Context normalization.
2. Angle inventory.
3. Script brief selection.
4. Script drafting.
5. Critic/rewriter pass.
6. Structured output.
7. Memory/template learning that stores what worked and what failed by category/type.

The current system tries to do all of this in one prompt. That is why it often repeats itself, defaults to the same basic desvalidar-alternativas idea, and needs too much manual prompting to get one decent script.

## Current Pipeline Map

### Frontend Entry Point

Main workspace: `src/pages/ProductWorkspace.tsx`.

Generation flow:

1. User opens a product/session.
2. Product, business, context docs, AI memory settings, active sales channel, brand kit, and script templates are loaded.
3. User configures script generation in `ScriptSettingsPanel`.
4. `handleGenerateScript()` creates a plain user message like:
   - mixed mode: `Genera exactamente 3 guión(es) de venta.`
   - by type: `Genera exactamente X guión(es): 1 Venta Directa, 1 Desvalidar Alternativas...`
   - organic-only/reconocimiento-only get special frontend text.
5. If the user typed extra input, it is appended as `PREFERENCIA DE ESTILO DEL USUARIO`.
6. Frontend calls `sendMessageToGrok()` in `src/services/grokApi.ts`.

Important files:

- `src/pages/ProductWorkspace.tsx`
- `src/components/ScriptSettingsPanel.tsx`
- `src/services/grokApi.ts`
- `src/utils/scriptParser.ts`
- `src/components/ScriptCard.tsx`

### Backend Entry Point

Main endpoint: `api/chat.ts`.

Backend flow:

1. Auth and rate/usage limits run.
2. Request is validated.
3. Backend detects:
   - `feature === 'description'`
   - `onlyReconocimiento`
   - `onlyOrganic`
   - `mixedOrganic`
   - product type: `restaurant`, `real_estate`, `service`, `indumentaria`, or generic `product`
4. Backend chooses one base prompt:
   - generic sales master prompt for generic products.
   - product-type prompt for restaurant/real estate/service/indumentaria.
   - reconocimiento prompt if only reconocimiento.
   - organic master prompt if only organic.
5. Backend appends prompt layers in this order:
   - business rules
   - product rules
   - winning script DNA
   - AI memory
   - brand voice
   - script templates
   - organic rules
   - CTA strength
   - settings/quantity/type requirements
   - context documents
   - structured context
   - legacy context fallback
6. Backend sends the full prompt to `grok-4.3` with `temperature: 0.8` and `max_tokens: 4096`.
7. Response is stored as an assistant message with the generated system prompt saved for debug.

Important files:

- `api/chat.ts`
- `api/data/organic-script-prompts.ts`
- `api/data/winning-script-dna.ts`
- `api/lib/memory-helpers.ts`
- `api/lib/brand-kit.ts`

## Data Model And Inputs

### Product Types

Defined in `src/types/index.ts`:

- `product`
- `service`
- `restaurant`
- `real_estate`
- `indumentaria`

### Script Types

Defined in `src/types/index.ts` and mirrored in `api/chat.ts`:

- `venta_directa`
- `desvalidar_alternativas`
- `mostrar_servicio`
- `variedad_productos`
- `paso_a_paso`
- `reconocimiento`
- `educativo`
- `storytelling`
- `tendencia`
- `engagement`

Organic types are handled specially:

- `educativo`
- `storytelling`
- `tendencia`
- `engagement`

CTA strength:

- `none`
- `soft`
- `brand_mention`
- `sales`

### Structured Context

The frontend sends two context objects:

- `businessContext`, built by `buildApiBusinessContext()`.
- `productContext`, built by `buildApiProductContext()`.

`buildStructuredContext()` in `api/chat.ts` converts these into labeled natural language.

This is good. The model gets business name, sales channels, location, shipping, audience, ICP, product category, alternatives, specs, benefits, service details, restaurant menu, real estate fields, and success cases.

Current weakness: context is dumped after most instructions, near the end of the system prompt. Since the final prompt is long, the model may over-follow the examples and prompt ideology before grounding itself in actual facts.

## Current Prompt Layers

### 1. Generic Sales Master Prompt

Used for generic `product` unless only organic/reconocimiento.

Strengths:

- Strong direct-response orientation.
- Clear structure: hook, development, CTA.
- Good anti-generic rules: no greetings, no repetition, tangible details, logistics in development.
- Includes useful archetypes.

Weaknesses:

- It repeatedly says "your only goal is to sell", which can contaminate mixed organic generations.
- The examples are few and can over-anchor outputs to iPads, beeswax wraps, facials, coffee, step-by-step.
- Desvalidar alternativas is defined very narrowly as "No compres X sin saber esto" plus 3 defects. That encourages repetitive outputs.
- It says tone must be "identical" to reference examples. This can reduce category adaptation.
- It uses rigid rules but does not ask for a hidden angle plan.

### 2. Category Prompts

Category prompts exist for:

- restaurant
- real estate
- service
- indumentaria
- reconocimiento

Strengths:

- Restaurant prompt is concrete and specialized.
- Real estate prompt correctly forces price/location/data.
- Service prompt correctly uses placeholders for missing proof.
- Indumentaria prompt knows material, sizes, identity, changes, personalization.
- Reconocimiento prompt separates brand awareness from ads.

Weaknesses:

- Service prompt hard-codes "GENERA 5 GUIONES" even when settings may ask for a different number.
- Restaurant prompt says the last script should be executive lunch, regardless of requested count/type.
- Product-type base prompts do not fully honor by-type requests. If a service user asks for `desvalidar_alternativas`, the service prompt still frames the generation around its five service angles.
- Category prompts are not modular by script type. They are whole alternate masters, so category x type combinations are fuzzy.
- Organic mixed with product-specific sales prompts relies on override blocks, which is fragile.

### 3. Business Rules

Generated by `buildBusinessRulesPrompt()`.

Strengths:

- Sales-channel routing is useful.
- Physical store vs messages vs website CTA logic is explicit.
- Audience and ICP are included.
- Shipping is included.

Weaknesses:

- Physical CTA is forced to exactly "Los esperamos." This is too blunt for many categories and can weaken direct response.
- Messages CTA is forced to "Envíanos un mensaje para..." which can create repetitive CTAs.
- Location-in-hook rules are hard-coded by channel and audience geography; they may fight restaurant/real estate prompts.
- CTA suppression for organic/reconocimiento is helpful, but mixed sales+organic still risks conflicting CTA logic.

### 4. Product Rules

Generated by `buildProductRulesPrompt()`.

Strengths:

- Adds category, guarantee, scarcity, variation, service method, success cases, indumentaria trust signals.

Weaknesses:

- Rules are mostly "mention this" instructions, not angle selection instructions.
- Generic products do not get enough support for weaker/incomplete context.
- Alternatives data is present in structured context but not converted into a better desvalidar strategy.

### 5. Winning Script DNA

Defined in `api/data/winning-script-dna.ts`.

Strengths:

- This is one of the best layers.
- It introduces detail density, logistics as value, anti-generic rules, angle maps, and category lenses.
- It explicitly says to use placeholders instead of inventing.

Weaknesses:

- It is still another instruction layer, not an enforced process.
- The angle map is generic and not selected per requested script.
- It does not output or require a per-script brief such as hook mechanism, buyer stage, objection, proof, CTA.
- It requires at least four details, but there is no validator to check this.

### 6. AI Memory

`api/lib/memory-helpers.ts` injects preferences, anti-patterns, rules, examples, visual style, facts.

Strengths:

- Good idea: it learns from saved/rated/edited scripts.
- Anti-patterns are valuable.

Weaknesses:

- Memory is inserted as another large priority block, not typed by script category/type.
- It can overfit to old user preferences and make every script sound similar.
- Positive examples are truncated and may bias the model toward repeated hooks/CTAs.
- Memory says "match examples exactly in energy & structure", which can increase repetition.
- There is no per-generation memory filter for only relevant categories. A preference learned from a restaurant script can influence indumentaria unless category metadata is stored and filtered.

### 7. Saved Script Templates

Loaded from `script_templates`.

Strengths:

- Allows user-selected winning examples.

Weaknesses:

- All active templates are injected together.
- No metadata about category, script type, hook type, offer type, buyer awareness level.
- The model is told to study templates, but not told which template to use for which requested script.
- Multiple active templates can conflict or blur into a generic average.

### 8. Organic Prompt Layer

Defined in `api/data/organic-script-prompts.ts`.

Strengths:

- Organic-only replaces sales prompt entirely.
- Organic rules clearly separate value-first content from sales.
- CTA strength is useful.

Weaknesses:

- Mixed organic + sales still uses the sales master and appends organic override. This asks the model to mentally switch DNAs in a single generation.
- Organic rules are structurally correct but still generic; they do not produce specific content territories first.
- Trend prompts can age quickly and become stale.

### 9. Edit / Enhance / Hook Pipeline

`src/components/ScriptCard.tsx` lets users:

- manually edit
- enhance
- change hooks
- change consciousness level
- rate scripts
- save scripts/templates

Critical issue: `editScript()` in `src/services/grokApi.ts` sends a custom editing system prompt to `/api/chat`, but `api/chat.ts` still prepends the full script-generation system prompt. The result is a stacked generation prompt plus an editing prompt. That can make edits less precise and can cause the model to rewrite more than requested.

Enhance prompt issue:

- The enhance prompt is very long and says it should answer "ganchos A y B", but the current script format is usually one `[GANCHO]`, not hook A/B.
- It forces direct sales logic even if the script is organic/reconocimiento.
- It says development should be bulletpoints, which can conflict with the original format.

Hook picker issue:

- Hook templates are useful, but many ask to "mantén desarrollo y CTA igual". That only changes the first line and does not replan the script. A strong new hook often requires development changes to pay it off.
- Hooks are template-based, not selected from product-specific objections/proofs.

## Main Problems Making The AI Dumber

### Problem 1: One Giant Prompt Instead Of A Pipeline

The system asks the model to:

- understand the business
- choose angles
- select hook mechanisms
- obey category rules
- obey sales channel rules
- use memory
- imitate templates
- avoid generic copy
- generate exact counts
- vary scripts
- self-critique

all in one model call.

This makes output unstable. The model often follows the loudest or most recent instruction instead of the best strategy.

Fix: create an explicit internal planning phase with structured briefs, then draft from those briefs.

### Problem 2: Diversity Is Requested But Not Enforced

Current rules say:

- vary approach/hook
- use different hook mechanisms
- do not repeat

But the model is not required to output or internally maintain a diversity grid.

Fix: force a script brief for each requested script:

- script type
- buyer awareness stage
- primary emotion
- hook mechanism
- objection/doubt eliminated
- proof/detail used
- CTA mechanism
- banned overlap with other scripts

Then draft each script from a different brief.

### Problem 3: Desvalidar Alternativas Is Too Narrow

Current desvalidar formula:

`No compres X sin saber esto` + 3 defects of competition + `En cambio nosotros...`

This creates repetition and shallow comparison.

Better desvalidar alternatives should include multiple subtypes:

- category mistake: "No todos los X son para Y."
- hidden cost: "Lo barato sale caro cuando..."
- wrong-fit warning: "Si necesitas X, no compres Y."
- process contrast: "La diferencia no está en el producto, está en cómo..."
- material/spec contrast: "Antes de comprar X, revisa [material/spec]."
- risk reversal: "Lo que nadie te dice antes de contratar X."
- use-case split: "Para A te sirve X, para B necesitas Y."
- myth correction: "El problema no es X, es Y."
- old way vs new way: "Antes se resolvía así, ahora..."
- decision checklist: "3 cosas que revisar antes de comprar X."

The system should choose desvalidar subtype based on available facts. If alternatives fields are weak, it should use a safe checklist or fit-based comparison instead of inventing competitor flaws.

### Problem 4: Category x Script Type Is Not Modeled

Right now product type selects a whole base prompt. Script type is appended later as a count/label requirement.

Example problem:

- Product type: `service`
- Requested type: `desvalidar_alternativas`
- Base prompt: service prompt wants 5 service angles.
- Settings prompt: asks for 1 desvalidar.

This conflict makes the model choose whichever instruction dominates.

Fix: use modular prompt composition:

- category lens: service/restaurant/real estate/indumentaria/product
- script type lens: venta directa/desvalidar/mostrar/etc.
- channel lens: physical/messages/website
- CTA lens: none/soft/brand/sales
- quality lens: anti-generic and detail density

### Problem 5: Context Is Not Converted Into Creative Options

The system dumps context but does not transform it into:

- strongest claims
- strongest doubts
- strongest proof
- strongest hooks
- weakest/missing facts
- audience segments
- use cases
- objections
- alternative comparisons

Fix: context normalization should create an "Angle Inventory" before drafting.

### Problem 6: Memory And Templates Can Overfit

The memory system may teach the model to repeat what the user liked before. This is useful for style, but dangerous for ideation.

Fix:

- Store memory by product type, script type, hook mechanism, CTA type, and outcome.
- Inject only relevant memories.
- Separate "style memory" from "idea memory".
- Add a diversity rule: do not reuse hooks/angles from the last N scripts unless user explicitly asks.

### Problem 7: Edit Endpoint Is Not Cleanly Separated

`editScript()` uses `/api/chat`, so edits inherit the full generation prompt.

Fix:

- Create `api/edit-script.ts`.
- Use only an editor system prompt plus context.
- Choose edit mode:
  - minimal edit
  - hook rewrite
  - sharpen for buyer stage
  - full rewrite from same brief
  - organic rewrite
- Preserve or change format based on script type.

### Problem 8: No Automated Quality Gate

The prompt says "rewrite if generic", but no code checks the result.

Fix: add a script evaluator that scores each script before returning:

- specificity score
- detail count
- repeated hook similarity
- category fit
- CTA fit
- format validity
- generic phrase count
- contradiction count
- invented fact risk

If a script fails, re-run only that script with a targeted repair prompt.

## Recommended New Architecture

### Stage 1: Normalize Context

Create a function like `buildScriptContextProfile()`.

Output:

```ts
interface ScriptContextProfile {
  productType: ProductType
  productName: string
  businessName?: string
  category?: string
  audienceSegments: string[]
  buyerReadinessSignals: string[]
  pains: string[]
  desires: string[]
  objections: string[]
  alternatives: Array<{ name: string; weakness?: string; ethicalContrast?: string }>
  proof: string[]
  logistics: string[]
  offerFacts: string[]
  sensoryFacts: string[]
  missingFacts: string[]
  bannedClaims: string[]
}
```

This should be deterministic code, not only prompt text.

### Stage 2: Build Angle Inventory

Ask the model, or deterministic code plus model, to generate an inventory:

```ts
interface AngleCandidate {
  id: string
  scriptType: ScriptFramework
  hookMechanism:
    | 'direct_offer'
    | 'buyer_fear'
    | 'alternative_invalidation'
    | 'checklist'
    | 'options_menu'
    | 'process_certainty'
    | 'social_proof'
    | 'price_location'
    | 'hidden_cost'
    | 'use_case_split'
    | 'story_scene'
    | 'myth_busting'
  buyerStage: 'cold' | 'warm' | 'hot'
  audienceSegment: string
  coreDoubt: string
  proofToUse: string[]
  logisticsToUse: string[]
  hookDraft: string
  whyItCouldWin: string
}
```

Rules:

- Generate at least 3x more candidates than scripts needed.
- Reject candidates that use the same hook mechanism twice unless requested count requires it.
- Reject candidates that do not have enough product/business facts.
- If context is weak, use placeholders but make them specific.

### Stage 3: Select Script Briefs

Select the best candidates based on requested settings.

Example:

```ts
interface ScriptBrief {
  index: number
  scriptType: ScriptFramework
  productType: ProductType
  angleId: string
  hookMechanism: string
  buyerStage: 'cold' | 'warm' | 'hot'
  openingPromise: string
  developmentBeats: string[]
  mustIncludeFacts: string[]
  mustAvoid: string[]
  cta: {
    strength: CTAStrength
    channel?: SalesChannel
    textDirection: string
  }
}
```

This is the missing layer. Once each script has a different brief, the model will stop repeating the same basic idea.

### Stage 4: Draft Scripts

Draft from briefs, not from raw product context only.

Prompt should be shorter:

- You are drafting scripts from locked briefs.
- Do not change the brief.
- Write only the requested script format.
- Use the facts.
- Use placeholders for missing facts.
- One idea per script.
- No generic phrases unless proven.

### Stage 5: Evaluate And Repair

Evaluator output:

```ts
interface ScriptQualityReport {
  index: number
  passed: boolean
  specificity: number
  hookStrength: number
  detailDensity: number
  categoryFit: number
  ctaFit: number
  repetitionRisk: number
  genericPhrases: string[]
  missingPayoff: string[]
  inventedClaims: string[]
  repairInstruction?: string
}
```

If `passed === false`, repair only the failed script.

### Stage 6: Return Structured Output

The model should return JSON internally, then frontend renders text. This will make parsing much more reliable than regex over arbitrary headers.

Suggested format:

```ts
interface GeneratedScript {
  index: number
  title: string
  scriptType: ScriptFramework
  hookMechanism: string
  buyerStage: string
  spokenScript: {
    hook: string
    development: string
    ctaOrClose: string
  }
  qualityNotes?: string[]
}
```

Frontend can display labels but copy/export only spoken script if needed.

## Category-Specific Recommendations

### Generic Product

Needs better transformation from product facts to angles.

Add product angle families:

- direct offer
- who it is for / who it is not for
- alternative contrast
- options menu
- material/spec proof
- use-case scenario
- gift/occasion
- mistake before buying
- price/value explanation
- logistics/risk reversal

Require at least one of:

- material/spec
- use case
- variation
- guarantee
- logistics
- concrete result
- price/value reason

### Service

Do not hard-code 5 scripts. Use requested count.

Service scripts need to make intangible things tangible:

- steps
- timeline
- tools/method
- deliverables
- before/after
- proof/cases
- qualification criteria
- guarantee
- risks of not solving

For weak service context, the model should generate specific placeholders:

- `[TIPO DE CLIENTE]`
- `[RESULTADO MEDIBLE]`
- `[TIEMPO]`
- `[PASO DEL MÉTODO]`
- `[OBJECIÓN PRINCIPAL]`

Desvalidar for services should usually compare:

- DIY vs expert process
- cheap provider vs qualified process
- generic service vs specialized method
- symptom treatment vs root cause
- one-off fix vs ongoing system

### Restaurant

Current restaurant prompt is one of the strongest, but too rigid.

Fix:

- Do not always force the last script to be executive lunch.
- Respect requested script count/type.
- Parse menu into dish candidates first:
  - dish name
  - category
  - sensory hooks
  - portion/price placeholders
  - shareability
  - lunch/dinner relevance
- Generate different restaurant angles:
  - signature dish
  - shareable platter
  - lunch decision
  - texture/sound
  - value/portion
  - location convenience
  - social proof/popular this week
  - new item/drop

### Real Estate

Current real estate prompt is solid for direct sale, but not flexible.

Add angle families:

- price/location filter
- investment math
- lifestyle scenario
- commute/reference point
- scarce feature
- comparison against other areas
- Airbnb yield/use case
- family fit
- downsizing/upsizing

Do not require price in hook if price is missing. Use `[PRECIO]` or choose location/feature filter.

### Indumentaria

Current indumentaria prompt is good but can become repetitive around "material + variety + CTA".

Add angle families:

- drop/new collection
- identity/tribe
- material proof
- fit/sizing confidence
- outfit/use occasion
- customization
- comparison against generic/synthetic
- giftability
- limited stock/drop
- change/return confidence

Require sensory/visual language but avoid empty "premium". Every quality claim needs material, construction, or policy proof.

### Reconocimiento

Keep separate from ads.

Improve by building story territories:

- founder truth
- customer identity moment
- behind-the-scenes contradiction
- niche frustration
- aspirational identity
- "nobody says this" confession
- small detail that proves care

Each reconocimiento script needs:

- one human scene
- one emotion
- one brand detail
- no benefits list
- no sales CTA

### Organico

Organic-only works conceptually, but needs content territories first.

For each organic type:

- Educativo: mistakes, checklists, myths, mini-frameworks, unpopular advice.
- Storytelling: founder, customer, process, failure, transformation, behind-the-scenes.
- Tendencia: should use current/relevant formats, but avoid stale hard-coded trends. Consider a configurable trend library.
- Engagement: ask a real question based on audience tension, not cheap comment bait.

Mixed organic + sales should ideally be separate calls or separate internal briefs. Do not ask one response to switch between ad logic and organic logic without a brief.

## Prompt Tuning Recommendations

### Replace "More Instructions" With "Briefs"

Bad current pattern:

> Vary the hooks. Do not be generic. Use details. Rewrite internally if generic.

Better:

> Before writing, create a private table of N unique briefs. Each brief must have a different hook mechanism, buyer stage, primary objection, and proof source. Draft one script from each brief. If two briefs share the same core idea, replace one before drafting.

### Better Desvalidar Prompt

Use this as a new script-type lens:

```text
DESVALIDAR ALTERNATIVAS does not always mean attacking competitors.
Its job is to help the buyer make a smarter decision and position this offer as the safer/better-fit choice.

Choose ONE subtype based on available facts:
1. Hidden cost: what the buyer loses with the common option.
2. Wrong-fit warning: when the common option is not for this buyer/use case.
3. Spec/material/process contrast: the concrete difference that changes the result.
4. Checklist: what to verify before buying/hiring.
5. Myth correction: the mistaken belief buyers use to choose.
6. Old way vs better way: why the usual path creates friction.
7. Use-case split: option A works for X, this offer works for Y.

Never invent competitor flaws. If facts are missing, use a decision checklist with placeholders.
The hook must name the decision being made, not only say "no compres X".
```

### Better Venta Directa Prompt

Venta directa should not always sound the same. Subtypes:

- direct offer
- price/value
- product clarity
- logistics/risk reversal
- hot buyer filter
- product drop
- proof/milestone
- use-case scenario

Brief should choose one subtype.

### Better Hook System

Instead of fixed hook templates only, build hooks from:

- buyer situation
- product category
- decision moment
- objection
- proof point
- differentiator
- consequence/risk
- desired outcome

Hook formula examples:

- `If you are about to [decision], check [specific criterion] first.`
- `For [audience] who need [outcome], this is [offer] with [proof/detail].`
- `The difference between [alternative] and [offer] is [specific mechanism].`
- `This is what [price/time/spec] gets you in [location/category].`
- `Most people choose [category] wrong because they only look at [surface metric].`

### Better User Preference Handling

Current user input becomes "style preference". That is too broad.

Classify user input into:

- style preference
- factual correction
- required angle
- banned angle
- CTA change
- audience change
- format change
- example/template

Then apply it in the correct stage.

## Implementation Plan

### Phase 1: Low-Risk Fixes

1. Remove hard-coded `GENERA 5 GUIONES` from service prompt. Let settings control count.
2. Remove restaurant "last script must be executive lunch" unless requested or enough count exists.
3. Make `api/edit-script.ts` separate from `api/chat.ts`.
4. Shorten the enhance prompt and make it type-aware.
5. Add stronger desvalidar subtype instructions.
6. Move structured context earlier in the prompt, before examples and style rules.
7. Add explicit "angle brief" requirements to `buildScriptSettingsPrompt()`.

### Phase 2: Structured Briefs

1. Add `buildScriptBriefs()` in backend.
2. Generate/select one brief per requested script.
3. Pass briefs into the drafting prompt.
4. Store brief metadata with generated scripts.
5. Show hook mechanism/type labels in UI.

### Phase 3: Quality Gate

1. Add evaluator prompt or deterministic checks.
2. Detect repeated hooks across generated batch.
3. Count concrete details/placeholders.
4. Detect generic banned phrases.
5. Repair failed scripts before returning.

### Phase 4: Memory Upgrade

1. Store memory metadata: product type, script type, hook mechanism, buyer stage, CTA type.
2. Filter injected memories by relevance.
3. Store anti-patterns separately from preferences.
4. Add "do not reuse recent hooks/angles" memory.
5. Let users pin winning templates to a category/type.

### Phase 5: Structured Output

1. Ask model for JSON.
2. Validate JSON server-side.
3. Render scripts from structured fields.
4. Replace regex parser as the primary parsing method.

## Suggested Backend Shape

Potential new modules:

- `api/lib/script-context-profile.ts`
- `api/lib/script-angle-inventory.ts`
- `api/lib/script-briefs.ts`
- `api/lib/script-quality.ts`
- `api/lib/script-prompts/category-lenses.ts`
- `api/lib/script-prompts/type-lenses.ts`
- `api/edit-script.ts`

Potential request/response:

```ts
interface GenerateScriptsRequest {
  businessContext?: BusinessContext
  productContext?: ProductContext
  scriptSettings: ScriptSettings
  activeSalesChannel?: SalesChannel
  userInstruction?: string
  contextDocuments?: ContextDocumentData[]
  brandKitId?: string
  scriptTemplateIds?: string[]
  aiMemoryEnabled?: boolean
}

interface GenerateScriptsResponse {
  scripts: GeneratedScript[]
  briefs: ScriptBrief[]
  qualityReports: ScriptQualityReport[]
  debug?: {
    contextProfile: ScriptContextProfile
    promptPreview: string
  }
}
```

## Specific Code Findings

### `api/chat.ts`

- Base prompt selection is centralized here.
- Prompt composition order currently puts context late.
- Service prompt conflicts with settings by hard-coding 5 scripts.
- Restaurant prompt may conflict by forcing final lunch script.
- Product-type prompts are whole masters, not composable lenses.
- `grok-4.3` with `temperature: 0.8` is used for all script generation. There is no model/temperature adjustment by task.

### `src/services/grokApi.ts`

- `DEFAULT_SCRIPT_SETTINGS` defaults to by-type-ish config values but `generationMode: 'mixed'`, so the per-type config is inactive by default.
- `model` setting exists but backend always uses Grok.
- `editScript()` uses `/api/chat`, causing generation prompt + edit prompt stacking.

### `src/pages/ProductWorkspace.tsx`

- Generation prompt is mostly a count/type request. The real work is backend prompt composition.
- User input is appended as style preference, even when it may be factual or structural.
- Active script templates are all passed together.
- Context building is decent, especially service success cases.

### `src/components/ScriptSettingsPanel.tsx`

- UI exposes useful controls.
- CTA strength auto-flips for all-organic vs all-sales.
- It does not expose buyer awareness level, hook diversity, or angle strategy.

### `src/components/ScriptCard.tsx`

- Save/rate/edit signals feed memory.
- Hook picker is useful but too template-based.
- Enhance prompt is too long, sales-only, and references hook A/B even though generated scripts often use one hook.

### `api/data/winning-script-dna.ts`

- Good high-level quality layer.
- Should become an evaluator/brief generator, not just appended text.

### `api/data/organic-script-prompts.ts`

- Good separation for organic-only.
- Mixed organic should use separate briefs or separate calls.

## What "Good" Should Mean

A good script should pass these gates:

1. The first line makes the buyer instantly know if the video is for them.
2. It uses a concrete angle, not generic persuasion.
3. It removes one real doubt.
4. It contains details from the actual business/product.
5. It does not repeat the same idea as another script in the batch.
6. It fits the requested script type.
7. It fits the product category.
8. It uses the correct CTA for channel and intent.
9. It sounds like spoken short-form video, not brochure copy.
10. It does not require 100 generations to get one usable option.

## Highest-Leverage Next Change

The single highest-leverage change is to add script briefs before drafting.

Even if everything else stays the same, forcing the model to privately plan:

- different hook mechanisms
- different buyer stages
- different objections
- different proof points
- different CTA logic

will dramatically reduce repetition and make outputs sharper.

Minimum viable prompt addition:

```text
Before writing, privately create one brief per requested script.
Each brief must be unique across:
- script type
- hook mechanism
- buyer stage
- main doubt being eliminated
- proof/detail used
- CTA angle

If two briefs are similar, replace the weaker one before drafting.
Do not show the briefs. Use them to write the final scripts.
```

Better implementation: generate structured briefs in code/model, validate them, then draft.

## Open Questions For Other Agents

1. Should generation become two model calls: one for briefs, one for final scripts?
2. Should mixed organic + sales be split into separate backend calls and merged?
3. Should the system store generated brief metadata in the `scripts` table?
4. Should user prompt input be classified before being appended?
5. Should templates become typed by product type/script type/hook mechanism?
6. Should `grok-4.3` remain the default drafting model, or should planning/evaluation use a different reasoning model?
7. Should we add a hard server-side validator for exact script counts and required sections?
8. Should AI memory be disabled by default for first-pass ideation and only applied to style after angle selection?

## Bottom Line

The current pipeline has strong pieces, but they are stacked in a way that makes the AI average them together. The result is often generic, repetitive, and hard to steer.

To get closer to actually good video scripts, the system needs to stop treating prompt text as the whole product. It needs an actual script strategy layer: context profile, angle inventory, unique briefs, drafting, and quality repair. That will make the AI produce better first drafts and make tuning feel like directing a smart strategist instead of begging a prompt to accidentally land.
