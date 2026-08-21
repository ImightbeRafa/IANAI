import { describe, expect, it } from 'vitest'
import { extractPageSignals, pickOfficialLogo, selectCrawlLinks } from '../api/analyze-site'
import { emptySetupFacts, mergeSiteAnalysisIntoFacts } from '../src/features/chat-shell/chatShellBrandSetupFlow'

describe('coordinated website analysis', () => {
  it('extracts visible content, real logo candidates, images, CSS, fonts, and colors', () => {
    const html = `<!doctype html><html><head>
      <title>ForgeCR — Forja tu postura</title>
      <meta name="description" content="Corrección postural de precisión">
      <script type="application/ld+json">{"@type":"Organization","name":"ForgeCR","logo":"https://forge.example/cdn/mark.png"}</script>
      <script type="application/ld+json">{"@type":"Product","name":"Arnés ForgeCR","offers":{"price":"14900"}}</script>
      <link rel="icon" href="/favicon.svg">
      <link rel="stylesheet" href="/assets/main.css">
      <style>.hero{color:#2563eb;font-family:'Space Grotesk',sans-serif}</style>
    </head><body>
      <header><img class="brand-logo" src="/images/logo.svg" alt="ForgeCR logo"></header>
      <a href="/faq">Preguntas frecuentes</a>
      <a href="https://other.example/product">External</a>
      <main><h1>Forja tu postura</h1><img class="product-gallery" src="/images/forge.jpg" alt="Arnés ForgeCR"></main>
    </body></html>`
    const result = extractPageSignals(html, 'https://forge.example/')
    expect(result.title).toBe('ForgeCR — Forja tu postura')
    expect(result.text).toContain('Forja tu postura')
    expect(result.text).toContain('STRUCTURED DATA:')
    expect(result.text).toContain('Arnés ForgeCR')
    expect(result.logoCandidates).toEqual([
      'https://forge.example/images/logo.svg',
      'https://forge.example/cdn/mark.png',
    ])
    expect(result.faviconCandidates).toEqual(['https://forge.example/favicon.svg'])
    expect(result.imageCandidates).toContain('https://forge.example/images/forge.jpg')
    expect(result.stylesheets).toEqual(['https://forge.example/assets/main.css'])
    expect(result.colors).toContain('#2563eb')
    expect(result.fonts).toContain('Space Grotesk')
  })

  it('only crawls high-value pages on the same origin', () => {
    const selected = selectCrawlLinks('https://forge.example/', [
      { url: 'https://forge.example/faq', label: 'Preguntas frecuentes' },
      { url: 'https://forge.example/about', label: 'Nuestra historia' },
      { url: 'https://forge.example/random/deep/page', label: 'Random' },
      { url: 'https://other.example/product', label: 'Producto externo' },
      { url: 'https://forge.example/catalog.pdf', label: 'Catálogo PDF' },
    ])
    expect(selected).toContain('https://forge.example/faq')
    expect(selected).toContain('https://forge.example/about')
    expect(selected).not.toContain('https://other.example/product')
    expect(selected).not.toContain('https://forge.example/catalog.pdf')
  })

  it('maps the complete analysis into the chat Brand Kit facts', () => {
    const facts = mergeSiteAnalysisIntoFacts(emptySetupFacts(''), {
      businessName: 'ForgeCR',
      salesChannels: ['website', 'messages'],
      storageType: 'product',
      offerName: 'Arnés ForgeCR',
      product_description: 'Corrector postural de precisión',
      main_problem: 'Mala postura por largas horas frente a pantallas',
      expected_result: 'Mejor alineación y soporte',
      differentiation: 'Compresión de grado médico y malla transpirable',
      key_objection: 'Comodidad debajo de la ropa',
      brand_voice: 'Técnica, precisa y aspiracional',
      tone_keywords: ['precisión', 'alto rendimiento'],
      must_use_phrases: ['Forja tu postura'],
      forbidden_phrases: [],
      primary_color: '#2563eb',
      logo_url: 'https://forge.example/logo.svg',
      reference_images: ['https://forge.example/product.jpg'],
    }, 'https://forge.example/')
    expect(facts.businessName).toBe('ForgeCR')
    expect(facts.salesChannels).toEqual(['website', 'messages'])
    expect(facts.main_problem).toContain('Mala postura')
    expect(facts.differentiation).toContain('Compresión')
    expect(facts.must_use_phrases).toEqual(['Forja tu postura'])
    expect(facts.logo_url).toBe('https://forge.example/logo.svg')
    expect(facts.sourceUrl).toBe('https://forge.example/')
  })

  it('reads srcset and JSON-LD organization logos, and prefers raster over favicon/SVG', () => {
    const html = `<!doctype html><html><head>
      <link rel="icon" href="/favicon.svg">
      <script type="application/ld+json">{"@type":["Organization","Brand"],"logo":{"url":"/cdn/forge.png"}}</script>
    </head><body>
      <header><img class="header__heading-logo" src="data:image/svg+xml;base64,PHN2Zz4=" srcset="/files/forge-wordmark.webp 1x" alt="Forge"></header>
    </body></html>`
    const result = extractPageSignals(html, 'https://forge.example/')
    expect(result.logoCandidates).toContain('https://forge.example/files/forge-wordmark.webp')
    expect(result.logoCandidates).toContain('https://forge.example/cdn/forge.png')
    expect(pickOfficialLogo(result.logoCandidates, result.faviconCandidates)).toBe('https://forge.example/files/forge-wordmark.webp')
    expect(pickOfficialLogo(
      ['https://forge.example/favicon.svg', 'https://forge.example/logo.svg'],
      ['https://forge.example/favicon.svg']
    )).toBe('https://forge.example/logo.svg')
  })
})
