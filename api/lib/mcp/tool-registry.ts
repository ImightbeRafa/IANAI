/**
 * Versioned MCP tool registry for Grok bot (primary) and later Codex.
 *
 * Dual mode:
 * - GUIDE: context/prompts/skills for Grok's own generation — no Advance credits
 * - EXECUTE: Advance APIs run generation — credits + approval
 */

import { CREATE_ADS_DECISION_TABLE } from './create-ads.js'

export type McpToolRisk = 'read' | 'guide' | 'sync_write' | 'execute' | 'delete' | 'admin'

export type McpToolGroupId =
  | 'brand_workspace'
  | 'guide_studio'
  | 'execute_studio'
  | 'library_sessions'
  | 'deletes'
  | 'account_team'
  | 'admin'

export type McpToolDefinition = {
  name: string
  group: McpToolGroupId
  risk: McpToolRisk
  description: string
  enabled: boolean
  requiresApproval: boolean
  consumesAdvanceCredits: boolean
}

export const MCP_REGISTRY_VERSION = '0.13.0'

export const MCP_TOOL_GROUPS: Record<McpToolGroupId, {
  title: string
  summary: string
  defaultEnabled: boolean
}> = {
  brand_workspace: {
    title: 'Brand Workspace',
    summary:
      'Brands, offers, and brand kits (CRUD + explicit business linking / PatchHouse) — shared with the web app.',
    defaultEnabled: true,
  },
  guide_studio: {
    title: 'Guide Studio',
    summary: 'Prompts and context so Grok generates with the user’s own Grok usage (no Advance credits).',
    defaultEnabled: true,
  },
  execute_studio: {
    title: 'Execute Studio',
    summary:
      'Advance-run scripts/images (credits + in-chat confirm_execute). MCP caps: bulk ≤10, carousel ≤5 slides.',
    defaultEnabled: true,
  },
  library_sessions: {
    title: 'Library & Sessions',
    summary: 'Sessions, provenance, URL/file intake into brand folders, deep links.',
    defaultEnabled: true,
  },
  deletes: {
    title: 'Archive & Deletes',
    summary: 'Archive brands/folders; permanent delete with clear no-recovery warnings.',
    defaultEnabled: true,
  },
  account_team: {
    title: 'Account & Team',
    summary: 'Usage and team/admin — same rules as the web app.',
    defaultEnabled: false,
  },
  admin: {
    title: 'Admin',
    summary: 'Admin-only tickets and usage. Hidden unless the user is an Advance admin.',
    defaultEnabled: false,
  },
}

export const MCP_TOOL_REGISTRY: McpToolDefinition[] = [
  // Brand / sync reads
  {
    name: 'list_brands',
    group: 'brand_workspace',
    risk: 'read',
    description:
      'List brands owned by the signed-in user (or team-visible). Archived brands are hidden (includeArchived:true to see them). Returns possibleDuplicates: groups of brands whose names match after normalizing — show them to the user and offer archive_brand for the extras (never merge automatically). ' +
      'To make a batch of ads for one of them: adpack_start {brandId, offerId (defaultOfferId), size, brief?} (optionally adpack_from_brand first to review gaps).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'get_brand_context',
    group: 'brand_workspace',
    risk: 'read',
    description:
      'Get one brand with offers and brand kit for GUIDE or EXECUTE. Optional brandKitId selects among linked kits.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'create_brand',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Create a brand from zero {name, location?, salesChannels? (website|messages|physical), doesShipping?, shippingMethod?, icpDescription?} — same record as the web brand form — and, by default, its primary brand kit (createKit:false to skip; kit {…update_brand_kit fields} to fill it now). ' +
      'If a brand with the same name already exists it is returned with status "exists" and nothing is created (allowDuplicate:true to force). Free sync write, no credits. ' +
      'Next: update_brand_kit → import_image {kind:"logo"} → create_offer → import_images (product photos with roles) → create_ads.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'import_image',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Import ONE image from a Google Drive share link (any shape: /file/d/<id>/view, open?id=, uc?id=, drive.usercontent…), Dropbox or any public https URL into a brand or offer: ' +
      '{brandId, offerId?, url, kind: product_photo|logo|reference_ad|winner_ad, role?: hero|part|box|contents|in_use|detail (product_photo), label? (e.g. "control"), variant? (logo: primary|light|dark|badge|wordmark|icon), setPrimary?}. ' +
      'The bytes are copied into Advance storage (the Drive link is kept only as sourceUrl), validated (real PNG/JPEG/WebP, SVG for logos; size caps; public hosts only) and analyzed: returns url, productImageId, quality {width, height, sharpness, backgroundClean, warnings}. ' +
      'A role:"hero" photo becomes the primary photo. Ads only show product parts that have a real photo with a role. A logo is cleaned (solid background removed → transparent PNG) and set on the primary kit; the cleanup report is returned. ' +
      'A Drive file that is not shared publicly answers DRIVE_NOT_PUBLIC ("el archivo de Drive no es público") — ask the owner to share it as "Anyone with the link". Free, no credits. Several images at once: import_images.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'import_images',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Batch import_image: {brandId, offerId?, items: [{url, kind, role?, label?, variant?, offerId?}] (max 12)}. Same validation and storage copy per item; one failure never stops the others (results[] with status imported|error and a plain error.message per item). Free, no credits.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'list_offers',
    group: 'brand_workspace',
    risk: 'read',
    description: 'List offers for an owned brand.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'create_offer',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Create an offer (product) for an owned brand — same record as the web offer form. Free sync write, no credits. ' +
      'Pass the REAL product name plus the form fields (description, differentiation, keyObjection, guarantee…) and the structured ad facts: ' +
      'price {amount, currency CRC|USD}, compareAtPrice, bundles [{qty, price, label}] (e.g. 2 kits = 29800), shipping {text, freeFromQty?, freeFromAmount?}, includes[], excludes[] ("Papel no incluido"), ' +
      'allowedClaims[], forbiddenClaims[], verifiedClaims [{claim, source}], cta {text, channels: web|whatsapp|dm}, ageMin / ageRule {min, supervision} ("Desde 8 años, con supervisión de un adulto"), contact {whatsapp, phone, url, instagram} (→ contact CTA "Escribinos al WhatsApp …"), paymentMethods[] (e.g. SINPE Móvil, tarjeta, efectivo), mustAppear[] (facts every ad must carry; default price, bundle, shipping, age, not_included, contact), immutableAttributes[], lockProductAppearance, allowedProps[], locale. ' +
      'Numbers, phones and URLs are validated strictly; placeholder values are not stored. Ads then use these exact strings as confirmed facts (e.g. "Envío gratis desde 2 kits"); verifiedClaims make claims strict (paraphrase allowed, numbers/units must match a fact).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'update_offer',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Update an owned offer {brandId, offerId, …any create_offer field}. Only the fields you pass change; null clears a structured field. Free sync write. ' +
      'Use it to fix a wrong name, add the price/bundle/shipping rule, mark what is not included, or remove false claims (forbiddenClaims). Returns confirmedFacts = exactly how ads will state them.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'set_primary_product_image',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Make one real product photo the hero of an offer {offerId, productImageId}. Packs and bulk posts use the primary photo first (instead of the newest upload). Free.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'tag_product_image',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Tag a product photo {productImageId, tags: hero|contenido-kit|caja|en-uso|detalle|part, role?} (role = kit part shown, e.g. "control"). "hero" photos are preferred after the primary. Free.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'create_upload_url',
    group: 'library_sessions',
    risk: 'sync_write',
    description:
      'Direct upload without the web app: {brandId, offerId?, kind: product_photo|logo|reference_ad|winner_ad|document, role?, filename, contentType} → signed uploadUrl. ' +
      'PUT the raw bytes there (content-type header), then call finalize_upload {uploadId}. product_photo needs offerId. Free, no credits.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'finalize_upload',
    group: 'library_sessions',
    risk: 'sync_write',
    description:
      'Finish a create_upload_url upload {uploadId}: checks the file exists, size and type limits, then saves it (product photo → productImageId on the offer; logo / reference ad / winner ad / document → primary brand kit) and returns its stable Advance URL. Idempotent. Free.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'list_assets',
    group: 'brand_workspace',
    risk: 'read',
    description:
      'List product, context, and generated images for an owned brand/offer. Returns stored HTTPS URLs and reusable productImageId values.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'list_scripts',
    group: 'brand_workspace',
    risk: 'read',
    description:
      'List saved scripts for an owned brand (optional offerId/sessionId). Returns full content so agents can reload copy after bulk/pack jobs.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'list_brand_kits',
    group: 'brand_workspace',
    risk: 'read',
    description: 'List brand kits (optionally filtered by brand). Free sync read.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'get_brand_kit',
    group: 'brand_workspace',
    risk: 'read',
    description: 'Get one brand kit detail by kitId (voice, palette, refs, Style DNAs).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'create_brand_kit',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Create a brand kit linked to a brand (business_id). Accepts the same fields as update_brand_kit. Free sync write — no Advance credits.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'update_brand_kit',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Update ANY brand kit field (free sync write): name, tagline, industry, brandVoice, toneKeywords, colors {primary, secondary, accent} (or primaryColor…), fonts {heading, body}, logoUrl, logoVariants [{url, variant}], referenceImageUrls, ' +
      'mustUsePhrases, forbiddenPhrases, visualStyleNotes, targetAudience, audiences [{label, ageMin, ageMax, geo}], locale ("es-CR"), register (voseo|tuteo|usted — a HARD rule), do[], dont[], styleDnaIds. ' +
      'Placeholder values ("country", "todo el país", "Personas 18–65", "N/A", "[…]") are never stored (reported in ignoredPlaceholders; a placeholder clears the field). External image links are copied into Advance storage.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'set_primary_brand_kit',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Make one kit the primary kit of a brand {brandId, brandKitId} (packs, GUIDE and EXECUTE use it by default). Links an unlinked kit; never moves a kit from another brand. Free.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'link_brand_kit',
    group: 'brand_workspace',
    risk: 'sync_write',
    description:
      'Link an unlinked kit to a brand (PatchHouse / business_id). Does not move kits between brands.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },

  // GUIDE — free for Advance credits
  {
    name: 'guide_script',
    group: 'guide_studio',
    risk: 'guide',
    description: 'Return brand-aware script brief + prompt for Grok text (user’s Grok usage).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'guide_image',
    group: 'guide_studio',
    risk: 'guide',
    description: 'Return Grok Imagine prompt, refs, size, and fidelity rules (user’s Grok Imagine usage).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'guide_brand_pack',
    group: 'guide_studio',
    risk: 'guide',
    description: 'Pack voice, palette, logo URL, offer facts for Grok without generating.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'guide_bulk_angles',
    group: 'guide_studio',
    risk: 'guide',
    description: 'Return a diverse buyer-niche angle board (not same-ad-different-words) with full hooks. Free GUIDE, cached 1 h per brand/offer/count/language (refresh: true for a new one). Every item carries adpackAngleId + adpackAngle (shared angle catalog: regalo, cómo funciona, valor/precio, qué incluye, uso real, detalle técnico, comparación, temporada, problema→solución, prueba social) that adpack_start accepts as {angles} or {angleIds}.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'list_style_dnas',
    group: 'brand_workspace',
    risk: 'read',
    description: 'List Style DNAs saved on the brand kit (organic/ads reference packs).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'set_style_dna',
    group: 'brand_workspace',
    risk: 'sync_write',
    description: 'Create or update a Style DNA on the brand kit (no generation credits).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },

  // Workspace sync writes (no generation credits)
  {
    name: 'workspace_save_url_context',
    group: 'library_sessions',
    risk: 'sync_write',
    description:
      'Save a source URL onto an owned brand and analyze it now (no credits, no cron needed): waits up to ~25 s and returns status ready (analysis) | failed, ' +
      'or status processing + jobId — then poll workspace_url_context_status { intakeId } (or get_execute_result { jobId }) every ~10 s; each poll continues the work. Brand data is filled only where empty.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'workspace_url_context_status',
    group: 'library_sessions',
    risk: 'read',
    description: 'Status of a URL saved with workspace_save_url_context (intakeId = its id/jobId). A pending or stuck analysis is resumed inline on this call. No credits.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'workspace_ingest_file',
    group: 'library_sessions',
    risk: 'sync_write',
    description: 'Accept file descriptors and return Advance upload deep link (PDF/images; no credits).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'workspace_note_generated_outside',
    group: 'library_sessions',
    risk: 'sync_write',
    description: 'Record session provenance that an image/script was generated outside Advance (no binary import).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'workspace_import_asset',
    group: 'library_sessions',
    risk: 'sync_write',
    description: 'Return Advance upload deep link for product/context refs (not external Grok outputs).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'workspace_save_artifact',
    group: 'library_sessions',
    risk: 'sync_write',
    description: 'Save a GUIDE/external script or image into the Advance library, including product/context refs from an https URL (no credits; no base64). External links (Drive, etc.) are copied into Advance storage; the original is kept as sourceUrl. For files without a public link use create_upload_url.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },

  // EXECUTE — Advance credits + in-chat confirm_execute (optional web fallback)
  {
    name: 'confirm_execute',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Approve or deny a pending Advance EXECUTE after the user confirms in THIS chat. ' +
      'Pass approvalRequestId from the previous approval_required response (the approval block shows items, unitCost, total, expiresAt). No web link is needed. ' +
      'After status=approved, immediately retry the same EXECUTE tool with that approvalRequestId.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'get_execute_result',
    group: 'execute_studio',
    risk: 'read',
    description:
      'Poll any async EXECUTE job by jobId (same as approvalRequestId). Returns running|completed|failed plus a bilingual statusMessage. ' +
      'Keep polling after an EXECUTE tool returns status=running so the artifact reaches chat without MCP client timeout. ' +
      'A failed result with code PLAN_CHANGED means nothing ran (approved vs planned differ): ask for a fresh approval. Also resolves workspace_save_url_context jobIds. ' +
      'For an Ad Pack job (adpack_start / create_ads pack, jobId = packId) it also returns the live pack status (pack, moreWork) and, when finished, the same deliverable as adpack_status.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'execute_script_generate',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate a script via Advance AI (credits). Without approvalRequestId, returns a chat confirmation prompt — show userPrompt, then call confirm_execute after the user says yes. ' +
      'After approve, returns quickly with jobId (status=running); poll get_execute_result until completed (includes script text). Same approvalRequestId is idempotent.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_generate',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Prefer create_ads for ads (exact text, feed+story). Generate one free-form image via Advance at max Grok quality 2k/medium (credits), with optional library reference ids and guidePrompt. Ratios 1:1, 4:5, 9:16, 16:9. productFidelity "exact" (default with a product photo) keeps the real product pixels on a generated scene and returns fidelity {score, passed}; "generated" redraws it. Ask in chat via userPrompt + confirm_execute — do not lead with a raw approval URL. ' +
      'After approve, returns quickly with jobId (status=running); poll get_execute_result until completed (includes imageUrl). Same approvalRequestId is idempotent.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_bulk_scripts',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Generate up to N diverse scripts from an angle board (3 credits each succeeded; one in-chat approval via confirm_execute). ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_bulk_posts',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Prefer create_ads mode pack for static ads. Generate varied posts for selected angles (6 or 24 credits each; may expand product refs; one in-chat approval via confirm_execute; runs exactly count/angleIds or answers PLAN_CHANGED). productImageIds = product photo pool (first = hero). ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_campaign_pack',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Prefer create_ads mode pack for static ads. Launch pack: angles → scripts → posts with one in-chat approval (confirm_execute) and a quoted total (runs exactly that count or answers PLAN_CHANGED). ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_edit',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Prefer create_ads mode edit. Edit an image via Advance (Grok Imagine; 18 credits). Defaults to the offer’s latest generated image when no source is supplied. Confirm in chat with userPrompt + confirm_execute. ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_image_enhance',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Enhance an image via Advance (Grok Imagine; 18 credits). Defaults to the offer’s latest generated image when no source is supplied. Confirm in chat with userPrompt + confirm_execute. ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'execute_carousel_generate',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Prefer create_ads mode carousel. Generate a carousel from scriptId or scriptContent via Advance (Gemini Pro, max 5 slides, 24 credits/slide; one in-chat approval). ' +
      'After approve, returns jobId + statusMessage; poll get_execute_result until completed.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },

  // One entry point for ads (G1) — routes to adpack / carousel / image edit
  {
    name: 'create_ads',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'START HERE to make ads for a saved brand: create_ads { brandId, offerId?, mode: pack|single|carousel|edit, count?, ratios?, brief? }. ' +
      'Routes to the right implementation with the same in-chat approval (approval { items, unitCost, total, expiresAt }) → confirm_execute → retry create_ads with the same arguments + approvalRequestId. ' +
      'pack/single then poll adpack_status with the packId; carousel/edit poll get_execute_result with the jobId. ' +
      'pack/single also accept the adpack_start options: productImageIds / productImageIdsByAd (photo pool, first = hero), saveToOffer + offerPatch / saveToBrandKit + brandKitPatch (persist chat corrections first), locale / register / forbiddenPhrases / forbiddenClaims, angleIds. ' +
      CREATE_ADS_DECISION_TABLE,
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },

  // Ad Pack engine (same service as POST /api/ad-pack) — 10 sell-ready static ads
  {
    name: 'adpack_from_brand',
    group: 'guide_studio',
    risk: 'guide',
    description:
      'Ad Pack for an EXISTING brand (happy path): list_brands → adpack_from_brand {brandId, offerId?} (optional, to review gaps) → adpack_start {brandId, offerId, size, brief?} → the user confirms in chat (confirm_execute) → poll adpack_status until moreWork=false → share the image links, captions and the brand-folder deepLink. ' +
      'This tool builds the Brand DNA + offer from what the owner already saved (brand, brand kit voice/colors/logo/forbidden phrases, offer form, real product photos, stored site analysis) — no URLs or uploads needed, no credits. ' +
      'Returns {dnaSummary, offer, gaps, notes, quote, missingPrice} (full dna only with includeDna:true — never re-send the profile: pass brandId/offerId). Only facts the owner typed are confirmed and only confirmed facts are used for prices/claims (a price appears only if the offer has a concrete price). ' +
      'If the user corrects facts in chat, persist them: saveToOffer:true + offerPatch {…update_offer fields} and/or saveToBrandKit:true + brandKitPatch {…update_brand_kit fields}. Optional productImageIds (photo pool, first = hero) / productImageIdsByAd. ' +
      'Before adpack_start, show the user the gaps; if missingPrice=true say clearly that no ad will show a price and ask whether to add it first or continue. ' +
      'Never invent brandId/offerId: use ids returned by list_brands / list_offers / this tool.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_dna_ingest',
    group: 'guide_studio',
    risk: 'guide',
    description:
      'Ad Pack for a NEW brand not saved in AdvanceAI: build the Brand DNA (facts, voice, audience, visual style, gaps) from a website URL, Instagram profile, https uploads, an offer form and/or user facts. No Advance credits. ' +
      'For a brand that already exists use adpack_from_brand / adpack_start {brandId} instead. Show dna.facts and dna.gaps to the user, then confirm with adpack_dna_confirm.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_dna_confirm',
    group: 'guide_studio',
    risk: 'sync_write',
    description:
      'Ad Pack step 2: apply the user\'s confirmations / edits / additions / removals to the DNA facts. Only confirmed facts may become claims (price, guarantee, delivery). Returns the updated dna. No credits.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_angles',
    group: 'guide_studio',
    risk: 'guide',
    description:
      'Ad Pack (optional): plan distinct ad angles from the shared angle catalog (regalo, cómo funciona, valor/precio, qué incluye, uso real, detalle técnico, comparación, temporada, problema→solución, prueba social only with verified proof) × hook × format for dna + offer, or for a saved brand via {brandId, offerId}. Each angle has a stable id "<category>-<hookType>-<format>" and a short rationale. Deterministic, no credits. Pass chosen ids as angleIds to adpack_start (guide_bulk_angles adpackAngleId values work too).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_quote',
    group: 'guide_studio',
    risk: 'read',
    description: 'Ad Pack: credit quote for a pack (size, or dna + offer for the planned size). No credits.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_start',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Ad Pack (create_ads mode pack routes here): start a pack of sell-ready static ads (credits per finished ad). For an existing brand pass {brandId, offerId, size, brief?} INSTEAD of dna/offer — the server builds them from the saved brand (no adpack_from_brand call required). ' +
      'Default ratios 4:5 (feed) + 9:16 (story); 1:1 on request or later free via adpack_resize. locale (e.g. "es-CR") makes the register a hard rule (voseo for CR); forbiddenPhrases/forbiddenClaims are verified on image text, caption and script. ' +
      'The approval shows the exact plan {items, unitCost, total}; on retry the plan is recomputed and, if count or credits differ, the tool answers status=plan_changed (code PLAN_CHANGED, approved vs planned) and runs nothing — ask the user again. ' +
      'brief = optional campaign context from the user (e.g. "Black Friday, focus on bundles"); it steers theme only and is never used as a fact. ' +
      'Corrected facts become permanent with saveToOffer:true + offerPatch / saveToBrandKit:true + brandKitPatch (written on the first call, reported in saved). productImageIds = photo pool (first = hero); productImageIdsByAd (alias photoPerAd) = {"1": [id]} per ad; heroRequired (default true) puts the hero photo in at least one ad; every ad reports photo {productImageId, url, role, label}. ' +
      'Creative control: creativeFreedom "high" (default when you give only brand/offer) lets Advance choose angle, hook, format, layout family and scene; pass angleIds (adpack_angles / guide_bulk_angles adpackAngleId) or angles (guide_bulk_angles adpackAngle objects) to steer. variations 1–3 = ads per angle (same copy, different scene/layout; credits = ads × variations). styleDnaId (list_style_dnas) makes the layouts follow the brand\'s winning ads; layoutFamily forces one look. The response lists per ad {angleId, category, hookType, format, layoutFamily, rationale}. ' +
      'Without approvalRequestId returns an in-chat confirmation (userPrompt + quote) — call confirm_execute after the user says yes, then retry with the same arguments plus approvalRequestId. ' +
      'Never invent brandId, offerId or approvalRequestId: use only ids returned by list_brands / list_offers / adpack_from_brand and the approvalRequestId returned by this tool. If adpack_from_brand reported missingPrice, tell the user before starting. ' +
      'Guarantees: only confirmed facts are used for prices/claims; text on the image is rendered exactly (never drawn by the image model). ' +
      'productFidelity "exact" (default when the offer has a product photo): the real product photo pixels are cut out and composited into a generated scene, scored for fidelity, and an ad whose product does not match is failed (never delivered); "generated" lets the image model redraw the product. Saved offers with lockProductAppearance always run exact; ad_profile immutableAttributes / allowedProps and tagged photos (primary/hero/part/caja/contenido-kit/en-uso/detalle) are applied automatically. Relighting is included and free: exact mode always harmonizes the real product into the scene (shading, white balance + grade, shadows, reflection, grain) without redrawing it; relight "ai" adds a guarded model pass at no extra cost. Optional: allowedProps (kit objects allowed in scenes), immutableAttributes (e.g. "hélices blancas"), offer.productPhotos with roles for multi-part products. Takes ~2 min per 10 ads. ' +
      'Returns packId; then poll adpack_status every ~20-30 s until moreWork=false.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },
  {
    name: 'adpack_preview',
    group: 'execute_studio',
    risk: 'read',
    description:
      'Ad Pack: FREE copy dry run before paying — adpack_preview {brandId, offerId, count, ratios?, angleIds?, brief?, …the same arguments as create_ads / adpack_start}. Runs planning + copy + fact checks (model text only: no images, no credits, no approval; max 10 per hour). ' +
      'Returns previewId and per ad {index, angleId, category, hookType, rationale, layoutFamily, photo (planned product photo), headline, subline, bullets, offerLine, cta, caption, check {ok, repairRounds, issues[{field, sentence, offendingTokens, nearestFactKey, nearestFact, rule}]}}. ' +
      'Show it to the user; create_ads / adpack_start with the SAME arguments (+ previewId) deliver exactly this copy (a changed request or offer answers plan_changed, nothing runs).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_status',
    group: 'execute_studio',
    risk: 'read',
    description:
      'Ad Pack: progress of a pack by packId (from adpack_start; never invent one). Returns summary (one human line with ready/failed counts and ~time left — relay it), etaSeconds and, while running, compact per-ad rows. ' +
      'Poll every ~20-30 s (work continues in the background between polls; a pack of 10 takes ~2 min) and STOP as soon as moreWork=false. ' +
      'When finished it returns deliverable {ads[{index, format, angleId, category, hookType, rationale, layoutFamily, variation?, headline, caption, links{4:5,9:16,…}, files[{ratio, url (full-res PNG), jpgUrl (same image as full-res JPG), width, height, format:"png", placement, fidelity?}], forbiddenHits[], fidelity{score, passed, method, diffImageUrl?}}], captionsText, deepLink}: present it as a numbered list of full-res files + captions with the angle and why (urls are stable public storage links, not expiring), offer captionsText to copy all captions, and share the deepLink. Any forbiddenHits → do not publish that ad before fixing it. fidelity.passed=false never ships (the ad fails instead). ' +
      'failures[] explains failed ads in plain language with the exact adpack_regenerate call to retry (paid, needs confirmation); copy failures carry issues[{field, sentence, offendingTokens, nearestFactKey, nearestFact, rule, limit?, actual?}] (copy is repaired up to 2 free rounds before an ad fails).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_edit_text',
    group: 'execute_studio',
    risk: 'sync_write',
    description:
      'Ad Pack: edit the on-image text or caption of one finished ad (headline, subline, bullets, offerLine, cta, caption) and re-render it instantly. Free. ' +
      'A rejection returns status=rejected with issues[{field (e.g. "bullets[2]"), rule (too_long, number_mismatch, unconfirmed_fact, forbidden_phrase, locale_register…), limit, actual, token, detail}] — show them and propose a fixed text. ' +
      'Step labels (01/02/03), confirmed prices and stated exclusions ("Papel no incluido") are allowed.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'adpack_regenerate',
    group: 'execute_studio',
    risk: 'execute',
    description:
      'Ad Pack: regenerate one ad (mode scene = new image, copy = new text + image). Use the exact call from adpack_status failures[].retry.call for a failed ad. Costs one ad of credits: in-chat confirmation via confirm_execute, then retry with approvalRequestId (never invent it) and poll adpack_status every ~20-30 s. ' +
      'FREE variant: { packId, itemId, ratio } regenerates only a ratio listed in the ad\'s rejectedRatios (the ad was delivered in its other ratios and charged once): re-composite, else a new background for that ratio alone, fidelity re-checked; no approval.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: true,
  },

  {
    name: 'adpack_resize',
    group: 'execute_studio',
    risk: 'sync_write',
    description:
      'Ad Pack: FREE — render a finished ad into more ratios (1:1, 4:5, 9:16, 16:9) from its stored scene and text. Renderer only: no model calls, no credits, no approval. Exact-mode ads re-composite the same real-product cut-out on the stored background (fidelity re-checked per ratio; a ratio that fails is listed in rejected, not delivered); method says composite or scene. ' +
      'Returns the ad with every render {ratio, imageUrl, width, height, format}; new renders are saved to the offer library.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },

  // Archive & deletes
  {
    name: 'archive_brand',
    group: 'deletes',
    risk: 'delete',
    description:
      'Archive a brand/folder, e.g. a duplicate from list_brands.possibleDuplicates (soft flag, recoverable; hidden from list_brands unless includeArchived). Requires the exact brand name as confirm + in-chat confirm_execute. Never merges or deletes data.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },
  {
    name: 'delete_offer',
    group: 'deletes',
    risk: 'delete',
    description:
      'Permanently delete an offer after typed confirm + in-chat confirm_execute (same rules as web).',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },
  {
    name: 'delete_brand',
    group: 'deletes',
    risk: 'delete',
    description:
      'Permanently delete a brand/folder after typed brand-name confirm + impact warning + in-chat confirm_execute (no recovery).',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },
  {
    name: 'delete_asset',
    group: 'deletes',
    risk: 'delete',
    description:
      'Permanently delete a product/context/generated image after typed confirm + in-chat confirm_execute.',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },
  {
    name: 'delete_brand_kit',
    group: 'deletes',
    risk: 'delete',
    description:
      'Permanently delete a brand kit after typed kit-name confirm + in-chat confirm_execute (no Advance credits).',
    enabled: true,
    requiresApproval: true,
    consumesAdvanceCredits: false,
  },

  // Team / admin
  {
    name: 'team_list_members',
    group: 'account_team',
    risk: 'admin',
    description: 'List team members when the user has team access.',
    enabled: false,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'admin_get_usage',
    group: 'admin',
    risk: 'admin',
    description: 'Admin-only usage summary (server-enforced).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'admin_list_tickets',
    group: 'admin',
    risk: 'admin',
    description: 'Admin-only list of feedback tickets (server-enforced).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'admin_get_ticket',
    group: 'admin',
    risk: 'admin',
    description: 'Admin-only ticket detail including diagnostics (server-enforced).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'admin_update_ticket',
    group: 'admin',
    risk: 'admin',
    description: 'Admin-only ticket status + comment update (server-enforced).',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
  {
    name: 'admin_request_cursor_fix',
    group: 'admin',
    risk: 'admin',
    description: 'Admin-only structured Cursor Cloud Agent brief for a ticket. Does not auto-call Cursor.',
    enabled: true,
    requiresApproval: false,
    consumesAdvanceCredits: false,
  },
]

export function listEnabledMcpTools(options?: {
  groupsEnabled?: Partial<Record<McpToolGroupId, boolean>>
  isAdmin?: boolean
}): McpToolDefinition[] {
  return MCP_TOOL_REGISTRY.filter((tool) => {
    if (tool.group === 'admin' || tool.risk === 'admin') {
      return Boolean(options?.isAdmin) && tool.enabled
    }
    const groupOn = options?.groupsEnabled?.[tool.group]
    const groupDefault = MCP_TOOL_GROUPS[tool.group].defaultEnabled
    const groupAllowed = groupOn === undefined ? groupDefault : groupOn
    return tool.enabled && groupAllowed
  })
}

export function getMcpTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOL_REGISTRY.find((tool) => tool.name === name)
}

export function listGuideTools(): McpToolDefinition[] {
  return MCP_TOOL_REGISTRY.filter((tool) => tool.risk === 'guide')
}

export function listExecuteTools(): McpToolDefinition[] {
  return MCP_TOOL_REGISTRY.filter((tool) => tool.risk === 'execute')
}
