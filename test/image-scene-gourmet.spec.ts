import { describe, expect, it } from 'vitest'
import {
  buildSceneRecipe,
  inferSceneNiche,
  studioVoidLanguageAbsent,
  wantsCompletePhotographedEnvironment,
} from '../api/lib/image-scene-recipe'
import { buildLifestyleCreativeBrief } from '../api/lib/image-prompt-context'
import { buildSlimGrokPostPrompt } from '../api/lib/grok-image-prompt'
import { resolveGrokImageApiMode } from '../api/lib/grok-image-generate'
import {
  GROK_IMAGE_EDITS_URL,
  GROK_IMAGE_GENERATIONS_URL,
} from '../api/lib/grok-models'
import {
  buildEnhanceSystemPrompt,
  resolveEnhanceTier,
} from '../api/lib/image-enhance'

describe('scene recipe — ad defaults (no scene ref)', () => {
  it('infers skincare niche from Bloom patch offer/script', () => {
    expect(inferSceneNiche({
      offerName: 'Bloom Dermal Micro-Infusion Patch',
      scriptContext: 'No te reventés ese granito con parches Bloom.',
      category: 'skincare',
    })).toBe('skincare')
  })

  it('emits SCENE RECIPE with place/light/props and bans studio void for ads', () => {
    const recipe = buildSceneRecipe({
      language: 'es',
      postStyle: 'venta-directa',
      hasSceneRef: false,
      offerName: 'Bloom Dermal Micro-Infusion Patch',
      scriptContext: 'Parches de micro-infusión para acné. ₡9.900.',
      category: 'belleza',
    })
    expect(recipe).toMatch(/SCENE RECIPE/)
    expect(recipe).toMatch(/Lugar:|Location:/)
    expect(recipe).toMatch(/Key light|Key light:|key/i)
    expect(recipe).toMatch(/Props de set|Set objects/)
    expect(recipe).toMatch(/PROHIBIDO:|FORBIDDEN:/)
    expect(recipe).toMatch(/fondo limpio|seamless paper|vacío de estudio|studio void/i)
    expect(studioVoidLanguageAbsent(recipe)).toBe(true)
    expect(recipe).toMatch(/tocador|baño|vanity|bathroom/i)
    expect(recipe).not.toMatch(/inventá un gym|invent a gym/i)
  })

  it('skips recipe for explicit studio-hero product photos', () => {
    expect(wantsCompletePhotographedEnvironment({
      postStyle: 'product',
      productSubStyle: 'studio-hero',
    })).toBe(false)
    expect(buildSceneRecipe({
      language: 'es',
      postStyle: 'product',
      productSubStyle: 'studio-hero',
    })).toBe('')
  })

  it('lifestyle brief for venta-directa without scene ref includes recipe and no studio-void pitch', () => {
    const brief = buildLifestyleCreativeBrief({
      language: 'es',
      postStyle: 'venta-directa',
      hasProductRef: true,
      hasSceneRef: false,
      hasStyleRef: false,
      offerName: 'Bloom Dermal Micro-Infusion Patch',
      scriptContext: 'No te reventés ese granito',
      category: 'skincare',
    })
    expect(brief).toMatch(/SCENE RECIPE/)
    expect(brief).toMatch(/LUGAR FOTOGRAFIADO COMPLETO|lugar fotografiado/i)
    expect(studioVoidLanguageAbsent(brief)).toBe(true)
    expect(brief).not.toMatch(/gym, oficina, baño, calle/)
  })

  it('slim Grok no-ref ad prompt includes SCENE RECIPE and bans studio void', () => {
    const slim = buildSlimGrokPostPrompt({
      language: 'es',
      postStyle: 'venta-directa',
      textDensity: 'hard',
      userCopy: 'No te reventés ese granito.\n₡9.900',
      hasProductRefs: false,
      offerName: 'Bloom Dermal Micro-Infusion Patch',
      category: 'skincare',
      scriptContext: 'parches dermal micro-infusion',
    })
    expect(slim).toMatch(/SCENE RECIPE/)
    expect(slim).toMatch(/PROHIBIDO vacío de estudio|FORBIDDEN studio void/i)
    expect(studioVoidLanguageAbsent(slim)).toBe(true)
  })
})

describe('Grok first-gen compose (not packshot-edit)', () => {
  it('uses generations/compose when product refs are present on generate', () => {
    const withRefs = resolveGrokImageApiMode({ action: 'generate', referenceCount: 2 })
    expect(withRefs.mode).toBe('compose')
    expect(withRefs.endpoint).toBe(GROK_IMAGE_GENERATIONS_URL)
    expect(withRefs.attachReferences).toBe(true)

    const noRefs = resolveGrokImageApiMode({ action: 'generate', referenceCount: 0 })
    expect(noRefs.mode).toBe('compose')
    expect(noRefs.endpoint).toBe(GROK_IMAGE_GENERATIONS_URL)
  })

  it('keeps edits endpoint for enhance and user edit', () => {
    expect(resolveGrokImageApiMode({ action: 'enhance', referenceCount: 1 })).toEqual({
      endpoint: GROK_IMAGE_EDITS_URL,
      mode: 'edit',
      attachReferences: true,
    })
    expect(resolveGrokImageApiMode({ action: 'edit', referenceCount: 1 }).mode).toBe('edit')
  })

  it('slim prompt with product refs says compose not packshot-edit', () => {
    const slim = buildSlimGrokPostPrompt({
      language: 'es',
      postStyle: 'venta-directa',
      userCopy: 'Parches Bloom',
      hasProductRefs: true,
      offerName: 'Bloom patches',
      category: 'skincare',
    })
    expect(slim).toMatch(/COMPOSÉ|compose/i)
    expect(slim).toMatch(/NO edites el packshot|Do NOT edit the packshot/i)
  })
})

describe('enhance polish vs scene pass', () => {
  it('polish does not claim a new set', () => {
    const polish = buildEnhanceSystemPrompt({
      language: 'es',
      tier: resolveEnhanceTier('polish'),
      hasProductRef: true,
    })
    expect(polish).toMatch(/POLISH/)
    expect(polish).toMatch(/set original|NO new set|no inventes un set nuevo|set nuevo/i)
    expect(polish).not.toMatch(/SCENE RECIPE/)
    expect(polish).not.toMatch(/Reconstruí la pieza en un LUGAR/)
  })

  it('rebuild / modernize allow scene upgrade language', () => {
    const rebuild = buildEnhanceSystemPrompt({
      language: 'es',
      tier: 'rebuild',
      hasProductRef: true,
    })
    expect(rebuild).toMatch(/SCENE|lugar fotografiado|scene pass/i)
  })
})
