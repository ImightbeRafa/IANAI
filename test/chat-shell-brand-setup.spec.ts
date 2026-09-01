import { describe, expect, it } from 'vitest'
import type { BrandKit, Business, ChatSession, Product } from '../src/types'
import {
  buildBrandSetupSnapshot,
  isFirstBrandSession,
  pickDefinedAutofill,
  productsOwnedByBusiness,
  readBrandSetupSkipped,
  resolveBusinessBrandKitId,
  shouldShowBrandSetup,
  shouldShowSetupTracker,
  stepComplete,
  writeBrandSetupSkipped,
  formatMissingSetupSteps,
  resolveKitChipTitle,
} from '../src/features/chat-shell/chatShellBrandSetup'
import { settingsCategories } from '../src/features/chat-shell/chatShellSettings'
import {
  classifyStorageType,
  buildFolderContext,
  createInitialFlow,
  emptySetupFacts,
  extractFirstUrl,
  factsHaveVisualIdentity,
  hasOfferHypothesis,
  isAffirmative,
  isBrandContextEditRequest,
  isBrandRuleRequest,
  isExplicitGenerationRequest,
  mergeExtractedBrandIntoFacts,
  nextSetupQuestion,
  normalizeBrandRule,
  normalizeHexColor,
  paletteDraftFromFacts,
  questionForSetupStep,
  seedFactsFromPastedText,
  type SetupQuestionId,
} from '../src/features/chat-shell/chatShellBrandSetupFlow'
import { appendBrandReferenceImages } from '../src/features/chat-shell/chatShellSetupUploads'

describe('brand behavior rules', () => {
  it('detects conversational rules without confusing ordinary generation asks', () => {
    expect(isBrandRuleRequest('No pongas más el precio del producto')).toBe(true)
    expect(isBrandRuleRequest('Siempre usa el logo de la marca')).toBe(true)
    expect(isBrandRuleRequest('Quiero crear un post')).toBe(false)
  })

  it('normalizes a rule for durable storage', () => {
    expect(normalizeBrandRule('  No muestres el precio del producto.  '))
      .toBe('No muestres el precio del producto')
  })
})

function business(partial: Partial<Business> & { name: string }): Business {
  return {
    id: 'b1',
    owner_id: 'u1',
    sales_channels: [],
    does_shipping: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

function product(partial: Partial<Product> & { name: string; type: Product['type'] }): Product {
  return {
    id: 'p1',
    ...partial,
  }
}

function session(partial: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    product_id: null,
    user_id: 'u1',
    title: 'New chat',
    status: 'active',
    framework: 'venta_directa',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    business_id: 'b1',
    ...partial,
  }
}

describe('chatShellBrandSetup completeness', () => {
  it('does not treat a name-only folder as complete', () => {
    const snapshot = buildBrandSetupSnapshot({
      business: business({ name: 'Forge' }),
      products: [],
      linkedKit: null,
    })
    expect(snapshot.businessBasics).toBe(false)
    expect(snapshot.stronglyComplete).toBe(false)
    expect(stepComplete(snapshot, 'business')).toBe(false)
  })

  it('requires an explicit sales channel for business basics', () => {
    const snapshot = buildBrandSetupSnapshot({
      business: business({ name: 'Forge', sales_channels: ['messages'] }),
      products: [],
      linkedKit: null,
    })
    expect(snapshot.businessBasics).toBe(true)
    expect(snapshot.operations).toBe(true)
    expect(snapshot.stronglyComplete).toBe(false)
  })

  it('requires location when the channel is physical', () => {
    const snapshot = buildBrandSetupSnapshot({
      business: business({ name: 'Forge', sales_channels: ['physical'] }),
      products: [],
      linkedKit: null,
    })
    expect(snapshot.operations).toBe(false)
    const located = buildBrandSetupSnapshot({
      business: business({ name: 'Forge', sales_channels: ['physical'], location: 'Escazú' }),
      products: [],
      linkedKit: null,
    })
    expect(located.operations).toBe(true)
  })

  it('treats a named product as offer core even without rich fields', () => {
    const snapshot = buildBrandSetupSnapshot({
      business: business({ name: 'Forge', sales_channels: ['messages'] }),
      products: [product({ name: 'Arness Forge', type: 'product' })],
      linkedKit: null,
    })
    expect(snapshot.offerCore).toBe(true)
    expect(stepComplete(snapshot, 'offer')).toBe(true)
  })

  it('names missing setup steps for pin and glass chip (no Falta afinar)', () => {
    const snapshot = buildBrandSetupSnapshot({
      business: business({ name: 'IdleBar Demo', sales_channels: ['messages'] }),
      products: [product({ name: 'Arnes Demo', type: 'product' })],
      linkedKit: null,
    })
    const missingEs = formatMissingSetupSteps(snapshot, 'es')
    const missingEn = formatMissingSetupSteps(snapshot, 'en')
    expect(missingEs).toMatch(/^Falta: /)
    expect(missingEs).toContain('Público')
    expect(missingEs).toContain('Fuentes')
    expect(missingEs).not.toMatch(/afinar/i)
    expect(missingEn).toMatch(/^Missing: /)
    expect(missingEn).toContain('Audience')
    expect(missingEn).toContain('Sources')
    expect(resolveKitChipTitle({
      kitReady: false,
      trackerVisible: true,
      missingLabel: missingEs,
      hasOfferName: true,
      labels: {
        kitReady: 'Brand Kit listo',
        kitNeedsTune: 'Falta afinar',
        kitNotReady: 'Brand Kit incompleto',
      },
    })).toBe(missingEs)
    expect(resolveKitChipTitle({
      kitReady: true,
      trackerVisible: false,
      missingLabel: null,
      hasOfferName: true,
      labels: {
        kitReady: 'Brand Kit listo',
        kitNeedsTune: 'Falta afinar',
        kitNotReady: 'Brand Kit incompleto',
      },
    })).toBe('Brand Kit listo')
  })

  it('evaluates offer core per product type', () => {
    const productOffer = product({
      name: 'Serum',
      type: 'product',
      product_description: 'Hydrating serum',
      utility: 'Daily moisture',
    })
    const serviceOffer = product({
      name: 'Coaching',
      type: 'service',
      main_problem: 'No clients',
      expected_result: 'Booked calendar',
      differentiation: '1:1 method',
    })
    const restaurantOffer = product({
      name: 'Bistro',
      type: 'restaurant',
      menu_text: 'Tacos',
      location: 'SJ',
      schedule: '9-9',
    })
    const realEstateOffer = product({
      name: 'Casa',
      type: 'real_estate',
      re_price: '$200k',
      re_location: 'Escazú',
      re_highlights: 'Garden',
      re_cta: 'Agenda',
    })
    const fashionOffer = product({
      name: 'Jacket',
      type: 'indumentaria',
      ind_article_type: 'ropa',
      ind_variations_description: 'Black/navy',
      ind_main_material: 'Leather',
    })

    for (const offer of [productOffer, serviceOffer, restaurantOffer, realEstateOffer, fashionOffer]) {
      const snapshot = buildBrandSetupSnapshot({
        business: business({ name: 'Forge', sales_channels: ['messages'] }),
        products: [offer],
        linkedKit: null,
      })
      expect(snapshot.offerCore).toBe(true)
    }
  })

  it('ignores the global default kit unless a session of this business links it', () => {
    const kit: BrandKit = {
      id: 'k1',
      user_id: 'u1',
      name: 'Default',
      logo_url: null,
      primary_color: null,
      secondary_color: null,
      accent_color: null,
      font_primary: null,
      font_secondary: null,
      tagline: null,
      industry: null,
      target_audience: null,
      brand_voice: 'Warm',
      tone_keywords: [],
      must_use_phrases: [],
      forbidden_phrases: [],
      visual_style_notes: null,
      reference_images: [],
      is_active: true,
      is_default: true,
      client_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }
    const snapshot = buildBrandSetupSnapshot({
      business: business({ name: 'Forge', sales_channels: ['messages'] }),
      products: [],
      linkedKit: null,
    })
    expect(snapshot.brandVoice).toBe(false)
    const linked = buildBrandSetupSnapshot({
      business: business({ name: 'Forge', sales_channels: ['messages'] }),
      products: [],
      linkedKit: kit,
    })
    expect(linked.brandVoice).toBe(true)
  })
})

describe('first session and skip', () => {
  it('shows setup only on the earliest session of a folder', () => {
    const first = session({ id: 's1', created_at: '2026-01-01T00:00:00.000Z' })
    const later = session({ id: 's2', created_at: '2026-02-01T00:00:00.000Z' })
    expect(isFirstBrandSession(first, [later, first])).toBe(true)
    expect(isFirstBrandSession(later, [later, first])).toBe(false)

    const snapshot = buildBrandSetupSnapshot({
      business: business({ name: 'Forge' }),
      products: [],
      linkedKit: null,
    })
    expect(shouldShowBrandSetup({
      loaded: true,
      business: business({ name: 'Forge' }),
      session: first,
      brandSessions: [first, later],
      snapshot,
      skipped: false,
    })).toBe(true)
    expect(shouldShowBrandSetup({
      loaded: true,
      business: business({ name: 'Forge' }),
      session: later,
      brandSessions: [first, later],
      snapshot,
      skipped: false,
    })).toBe(false)
    expect(shouldShowSetupTracker({
      loaded: true,
      business: business({ name: 'Forge' }),
      session: later,
      snapshot,
    })).toBe(true)
  })

  it('a second folder is independent', () => {
    const forge = session({ id: 's1', business_id: 'forge' })
    const patch = session({ id: 's2', business_id: 'patch', created_at: '2026-03-01T00:00:00.000Z' })
    expect(isFirstBrandSession(patch, [forge, patch])).toBe(true)
  })

  it('skip is isolated by user and business and reopen overrides it', () => {
    const store: Record<string, string> = {}
    const storage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
    }
    expect(writeBrandSetupSkipped(storage, 'u1', 'b1', true)).toBe(true)
    expect(readBrandSetupSkipped(storage, 'u1', 'b1')).toBe(true)
    expect(readBrandSetupSkipped(storage, 'u1', 'b2')).toBe(false)
    expect(readBrandSetupSkipped(storage, 'u2', 'b1')).toBe(false)
    expect(writeBrandSetupSkipped(storage, 'u1', 'b1', false)).toBe(true)
    expect(readBrandSetupSkipped(storage, 'u1', 'b1')).toBe(false)

    const first = session({ id: 's1' })
    const snapshot = buildBrandSetupSnapshot({
      business: business({ name: 'Forge' }),
      products: [],
      linkedKit: null,
    })
    expect(shouldShowBrandSetup({
      loaded: true,
      business: business({ name: 'Forge' }),
      session: first,
      brandSessions: [first],
      snapshot,
      skipped: true,
    })).toBe(false)
    expect(shouldShowBrandSetup({
      loaded: true,
      business: business({ name: 'Forge' }),
      session: first,
      brandSessions: [first],
      snapshot,
      skipped: true,
      forceOpen: true,
    })).toBe(true)
  })

  it('inherits the latest linked kit on the business, not a global default', () => {
    expect(resolveBusinessBrandKitId([
      session({ id: 's1', brand_kit_id: null, updated_at: '2026-01-02T00:00:00.000Z' }),
      session({ id: 's2', brand_kit_id: 'kit-old', updated_at: '2026-01-01T00:00:00.000Z' }),
      session({ id: 's3', brand_kit_id: 'kit-new', updated_at: '2026-01-03T00:00:00.000Z' }),
    ])).toBe('kit-new')
    expect(resolveBusinessBrandKitId([
      session({ id: 's1', brand_kit_id: null }),
    ])).toBeNull()
  })
})

describe('strict autofill sanitizer', () => {
  it('drops empty strings, invalid enums, and empty arrays', () => {
    expect(pickDefinedAutofill({
      name: 'Forge',
      location: '',
      sales_channels: ['messages', 'fax'],
      type: 'spaceship',
      audience_geographic_scope: 'galaxy',
      extras: [],
    })).toEqual({
      name: 'Forge',
      sales_channels: ['messages'],
    })
  })
})

describe('settings categories', () => {
  it('hides admin categories and Preferencias de IA for regular users', () => {
    expect(settingsCategories(false).map((c) => c.id)).toEqual([
      'general', 'brand', 'billing', 'updates',
    ])
    expect(settingsCategories(true).some((c) => c.id === 'admin')).toBe(true)
    expect(settingsCategories(true).some((c) => c.id === 'tickets')).toBe(true)
    expect(settingsCategories(true).map((c) => c.id)).not.toContain('ai')
    expect(settingsCategories(true, false).map((c) => c.id)).toEqual([
      'general', 'brand', 'billing', 'updates',
    ])
  })
})

describe('conversational setup flow', () => {
  it('starts with one intro question, not a form', () => {
    const flow = createInitialFlow('es', 'Forge')
    expect(flow.turns).toHaveLength(1)
    expect(flow.turns[0].role).toBe('assistant')
    expect(flow.pendingQuestion).toBe('source')
    expect(flow.turns[0].content).not.toMatch(/Guardar/)
  })

  it('treats a URL as a source and generation phrasing as a bypass', () => {
    expect(extractFirstUrl('mira https://www.forge.shopping/ ahora')).toBe('https://www.forge.shopping/')
    expect(isExplicitGenerationRequest('generame 3 guiones de venta')).toBe(true)
    expect(isExplicitGenerationRequest('generar post')).toBe(true)
    expect(isExplicitGenerationRequest('Quiero crear un post')).toBe(true)
    expect(isExplicitGenerationRequest('https://www.forge.shopping/')).toBe(false)
  })

  it('recognizes conversational requests that should update saved brand context', () => {
    expect(isBrandContextEditRequest('Cambia el tono de la marca a directo y técnico')).toBe(true)
    expect(isBrandContextEditRequest('Actualiza el público a profesionales de oficina')).toBe(true)
    expect(isBrandContextEditRequest('Quiero crear un post')).toBe(false)
  })

  it('keeps the pasted offer name when a URL is in the same message', () => {
    const seeded = seedFactsFromPastedText(
      emptySetupFacts('ForgeV2'),
      'Arnés ForgeCR / CRC 14,900 / https://www.forge.shopping/'
    )
    expect(seeded.sourceUrl).toBe('https://www.forge.shopping/')
    expect(seeded.offerName).toBe('Arnés ForgeCR')
    expect(seeded.product_description).toContain('Arnés ForgeCR')
  })

  it('treats confirmations and a small typo as confirmations, not as product copy', () => {
    expect(isAffirmative('Si correcto')).toBe(true)
    expect(isAffirmative('Correcto.')).toBe(true)
    expect(isAffirmative('coorrecto')).toBe(true)
    expect(isAffirmative('el nombre es Arnés')).toBe(false)
  })

  it('writes the full confirmed brand context used by generation', () => {
    const facts = {
      ...emptySetupFacts('Forge'),
      offerName: 'Arnés Forge',
      salesChannels: ['website'] as const,
      icp: 'atletas y profesionales de oficina',
      product_description: 'Corrector postural de precisión',
      main_problem: 'mala postura y dolor',
      expected_result: 'postura estable',
      differentiation: 'compresión de grado médico',
      key_objection: 'comodidad bajo la ropa',
      brand_voice: 'experta, directa y cercana',
      must_use_phrases: ['precisión que se siente'],
      forbidden_phrases: ['cura milagrosa'],
      primary_color: '#111111',
      logo_url: 'https://example.com/logo.png',
      sourceUrl: 'https://forge.example',
    }
    const context = buildFolderContext(facts, 'es')
    expect(context).toContain('Marca: Forge')
    expect(context).toContain('Problema principal: mala postura y dolor')
    expect(context).toContain('Diferenciador: compresión de grado médico')
    expect(context).toContain('Voz de marca: experta, directa y cercana')
    expect(context).toContain('Frases que evita: cura milagrosa')
    expect(context).toContain('Logo oficial: disponible en el Brand Kit')
    expect(context).toContain('Fuente principal: https://forge.example')
  })

  it('asks nothing more after the offer is confirmed — resume is the review step', () => {
    const state = {
      ...createInitialFlow('es', 'Bistro'),
      confirmOffered: true,
      facts: {
        ...emptySetupFacts('Bistro'),
        storageType: 'restaurant' as const,
        typeConfidence: 'high' as const,
        offerName: 'Bistro',
        menu_text: '',
        offerConfirmed: true,
        sourceText: 'cafe',
        salesChannels: ['physical'] as const,
        location: 'SJ',
        icp: 'locales',
      },
    }
    expect(nextSetupQuestion(state)).toBe('brand_visual')
  })

  it('does not interrogate product benefits after confirm', () => {
    const state = {
      ...createInitialFlow('en', 'Forge'),
      confirmOffered: true,
      asked: ['source', 'channels', 'audience', 'offer_name'] as SetupQuestionId[],
      facts: {
        ...emptySetupFacts('Forge'),
        storageType: 'product' as const,
        typeConfidence: 'high' as const,
        offerName: 'Adapter',
        offerConfirmed: true,
        sourceText: 'shop',
        salesChannels: ['website'] as const,
        icp: 'drivers',
        product_description: '',
      },
    }
    expect(nextSetupQuestion(state)).toBe('brand_visual')
  })

  it('stops after brand visual is asked or filled', () => {
    const state = {
      ...createInitialFlow('es', 'Bistro'),
      confirmOffered: true,
      asked: ['brand_visual'] as SetupQuestionId[],
      facts: {
        ...emptySetupFacts('Bistro'),
        offerConfirmed: true,
        offerName: 'Bistro',
      },
    }
    expect(nextSetupQuestion(state)).toBeNull()
  })

  it('maps a tracker step onto the matching chat question', () => {
    const facts = emptySetupFacts('Forge')
    expect(questionForSetupStep('brand', facts)).toBe('brand_visual')
    expect(questionForSetupStep('brand', { ...facts, brand_visual: 'azul y foto limpia' })).toBe('brand_voice')
    expect(questionForSetupStep('audience', facts)).toBe('audience')
  })

  it('does not quiz leftover fields after the resume is shown', () => {
    const state = {
      ...createInitialFlow('es', 'Forge'),
      confirmOffered: true,
      asked: ['source'] as SetupQuestionId[],
      facts: {
        ...emptySetupFacts('Forge'),
        offerName: 'Arnés ForgeCR',
        product_description: 'Arnés ForgeCR / CRC 14,900',
        sourceUrl: 'https://www.forge.shopping/',
        storageType: 'product' as const,
        typeConfidence: 'high' as const,
        salesChannels: [] as const,
        icp: '',
        offerConfirmed: false,
      },
    }
    expect(nextSetupQuestion(state)).toBeNull()
  })

  it('goes to confirm-offer when a hypothesis exists and confirm was not shown yet', () => {
    const state = {
      ...createInitialFlow('es', 'Forge'),
      confirmOffered: false,
      facts: {
        ...emptySetupFacts('Forge'),
        offerName: 'Forge Shopping',
        product_description: 'Adapters',
        sourceUrl: 'https://www.forge.shopping/',
        storageType: 'product' as const,
      },
    }
    expect(hasOfferHypothesis(state.facts)).toBe(true)
    expect(nextSetupQuestion(state)).toBeNull()
  })

  it('maps custom/general labels onto an existing product type', () => {
    expect(classifyStorageType({ type_label: 'software for restaurants' }).storageType).toBe('product')
    expect(classifyStorageType({ type: 'service' })).toEqual({
      storageType: 'service',
      customLabel: '',
      typeConfidence: 'high',
    })
  })
})

describe('extracted brand palette', () => {
  it('normalizes short and long hex colors', () => {
    expect(normalizeHexColor('#0af')).toBe('#00aaff')
    expect(normalizeHexColor('#112233')).toBe('#112233')
    expect(normalizeHexColor('blue')).toBeNull()
  })

  it('merges site extract into facts and skips the brand-visual question', () => {
    const facts = mergeExtractedBrandIntoFacts(emptySetupFacts('Forge'), {
      primary_color: '#0A4C8A',
      secondary_color: '#eee',
      accent_color: '#f90',
      voice_tone: 'cercano',
      style_notes: 'foto de producto, fondo claro',
      logo_url: 'https://cdn.example/logo.png',
      css_colors: ['#0A4C8A', '#111111', 'nope'],
    })
    expect(facts.primary_color).toBe('#0a4c8a')
    expect(facts.secondary_color).toBe('#eeeeee')
    expect(facts.brand_voice).toBe('cercano')
    expect(factsHaveVisualIdentity(facts)).toBe(true)
    const draft = paletteDraftFromFacts(facts)
    expect(draft?.candidates).toContain('#0a4c8a')
    expect(draft?.candidates).toContain('#111111')

    const state = {
      ...createInitialFlow('es', 'Forge'),
      confirmOffered: true,
      facts: { ...facts, offerConfirmed: true, offerName: 'Arnés' },
    }
    expect(nextSetupQuestion(state)).toBeNull()
  })

  it('appends unique brand reference urls', () => {
    expect(appendBrandReferenceImages(['a'], 'a')).toEqual(['a'])
    expect(appendBrandReferenceImages(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('ignores offers that belong to another business folder', () => {
    const owned = productsOwnedByBusiness([
      product({ id: 'bloom', name: 'Ramo QA', type: 'product', business_id: 'bloom' }),
      product({ id: 'luna', name: 'Café Luna', type: 'product', business_id: 'b1' }),
    ], 'b1')
    expect(owned.map((row) => row.name)).toEqual(['Café Luna'])
    expect(productsOwnedByBusiness(owned, null)).toEqual([])
  })
})
