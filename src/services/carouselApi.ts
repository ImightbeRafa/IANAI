import { supabase } from '../lib/supabase'
import type { OrganicCarouselSubtype, CTAStrength } from '../types'
import { fetchJson } from '../utils/apiFetch'

const CAROUSEL_API_URL = import.meta.env.PROD
  ? '/api/generate-carousel'
  : 'http://localhost:3000/api/generate-carousel'

export type CarouselAspectRatio = '1:1' | '4:5' | '9:16' | '3:4'

export interface GenerateCarouselRequest {
  productId: string
  subtype: OrganicCarouselSubtype
  slideCount: number
  scriptContent: string
  aspectRatio: CarouselAspectRatio
  language: 'en' | 'es'
  brandKitId?: string
  ctaStrength?: CTAStrength
  designDirection?: string
  slideDetails?: string
  previewFirstSlideOnly?: boolean
  productContext?: {
    name?: string
    type?: string
    category?: string
    description?: string
    audience?: string
    differentiation?: string
    result?: string
    objection?: string
    logistics?: string
  }
  productReferenceImages?: string[]
  contextReferenceImages?: string[]
  carouselReferenceImages?: string[]
}

export interface GeneratedSlide {
  index: number
  role: 'hook' | 'body' | 'cta' | 'recap'
  headline: string
  body?: string
  note?: string
  imageUrl: string | null
  error: string | null
}

export interface GenerateCarouselResponse {
  carouselGroupId: string
  subtype: OrganicCarouselSubtype
  totalSlides: number
  aspectRatio: CarouselAspectRatio
  language: 'en' | 'es'
  ctaStrength: CTAStrength
  plan: Array<{ index: number; role: string; headline: string; body?: string; note?: string }>
  slides: GeneratedSlide[]
  usage: { charged: number; total: number }
  previewFirstSlideOnly?: boolean
}

/**
 * Generate an organic carousel (2–10 slides) for the given product.
 * The backend handles: slide planning (Grok), slide 1 render (Gemini), slides 2..N render
 * in parallel with slide 1 as style anchor. Usage is charged per-succeeded-slide.
 */
export async function generateCarousel(req: GenerateCarouselRequest): Promise<GenerateCarouselResponse> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Not authenticated')

  const data = await fetchJson<GenerateCarouselResponse>(CAROUSEL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(req),
  }, {
    timeoutMs: 240_000,
    timeoutMessage: 'Carousel generation is taking too long. Try fewer slides or try again in a few seconds.',
    invalidJsonMessage: 'The server returned an invalid response during carousel generation',
    fallbackError: 'Carousel generation failed',
  })
  return data
}
