import { describe, expect, it } from 'vitest'
import type { SiteAnalysisResult } from '../api/lib/site-analysis'
import {
  buildFillOnlyBrandKitPatch,
  buildFillOnlyBusinessPatch,
  sanitizeWorkerError,
} from '../api/lib/mcp/url-analysis-merge'

const analysis: SiteAnalysisResult = {
  facts: {
    location: 'San José',
    shippingMethod: 'Correos',
    doesShipping: true,
    salesChannels: ['website', 'messages'],
    icp: 'Dueños de PyMEs',
    businessName: 'ForgeCR',
    primary_color: '#112233',
    brand_voice: 'Claro y cercano',
    tagline: 'Hecho para crecer',
    logo_url: 'https://cdn.example/logo.png',
  },
  evidence: {},
  pages: [],
  assets: {
    logoCandidates: [],
    faviconCandidates: [],
    imageCandidates: [],
    colors: [],
    fonts: [],
  },
  warnings: [],
}

describe('url analysis fill-only merge', () => {
  it('fills empty business fields only', () => {
    const patch = buildFillOnlyBusinessPatch({
      location: '',
      shipping_method: null,
      does_shipping: false,
      sales_channels: [],
      icp_description: null,
    }, analysis)
    expect(patch).toEqual({
      location: 'San José',
      shipping_method: 'Correos',
      does_shipping: true,
      sales_channels: ['website', 'messages'],
      icp_description: 'Dueños de PyMEs',
    })

    const noOverwrite = buildFillOnlyBusinessPatch({
      location: 'Cartago',
      shipping_method: 'Pickup',
      does_shipping: true,
      sales_channels: ['physical'],
      icp_description: 'Existing ICP',
    }, analysis)
    expect(noOverwrite).toEqual({})
  })

  it('fills empty brand kit fields and keeps authored values', () => {
    const createPatch = buildFillOnlyBrandKitPatch(null, analysis, 'Fallback')
    expect(createPatch.name).toBe('ForgeCR')
    expect(createPatch.primary_color).toBe('#112233')
    expect(createPatch.brand_voice).toBe('Claro y cercano')

    const keep = buildFillOnlyBrandKitPatch({
      name: 'Mine',
      primary_color: '#000000',
      brand_voice: 'Already set',
      logo_url: null,
      tagline: '',
    }, analysis, 'Fallback')
    expect(keep.name).toBeUndefined()
    expect(keep.primary_color).toBeUndefined()
    expect(keep.brand_voice).toBeUndefined()
    expect(keep.logo_url).toBe('https://cdn.example/logo.png')
    expect(keep.tagline).toBe('Hecho para crecer')
  })

  it('sanitizes worker errors', () => {
    expect(sanitizeWorkerError(new Error('  boom  '))).toBe('boom')
    expect(sanitizeWorkerError('x'.repeat(600)).length).toBe(480)
  })
})
