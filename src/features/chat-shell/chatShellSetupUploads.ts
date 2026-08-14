import { supabase } from '../../lib/supabase'
import { uploadBrandKitAsset } from '../../services/imageStorage'
import {
  autoFillFromText,
  gatherSetupSource,
  type FormType,
} from '../../utils/formAutoFill'
import { pickDefinedAutofill } from './chatShellBrandSetup'

function apiUrl(path: string): string {
  return import.meta.env.PROD ? path : `http://localhost:3000${path}`
}

export type SiteFieldOrigin = 'web' | 'inferred' | 'missing'

export interface SiteFieldEvidence {
  origin: SiteFieldOrigin
  confidence: number
  evidence: string[]
  sourceUrls: string[]
}

export interface SetupSiteAnalysis {
  facts: Record<string, unknown>
  evidence: Record<string, SiteFieldEvidence>
  pages: Array<{ url: string; title: string; ok: boolean }>
  assets: {
    logoCandidates: string[]
    faviconCandidates: string[]
    imageCandidates: string[]
    colors: string[]
    fonts: string[]
  }
  warnings: string[]
}

async function authToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

export async function ingestSetupSource(
  url: string | null,
  notes: string,
  formType: FormType,
  language: string
): Promise<{ data: Record<string, unknown>; content: string; error?: string }> {
  const gathered = await gatherSetupSource(url, notes, language)
  if (!gathered.content) return { data: {}, content: '', error: gathered.error }
  const { data, error } = await autoFillFromText(gathered.content, formType, language)
  if (error || !data) return { data: {}, content: gathered.content, error: error || 'Empty auto-fill' }
  return { data: pickDefinedAutofill(data), content: gathered.content, error: gathered.error }
}

export async function ingestSetupUrl(
  url: string,
  formType: FormType,
  language: string
): Promise<{ data: Record<string, unknown>; error?: string }> {
  return ingestSetupSource(url, '', formType, language)
}

export async function ingestSetupText(
  text: string,
  formType: FormType,
  language: string
): Promise<{ data: Record<string, unknown>; error?: string }> {
  return ingestSetupSource(null, text, formType, language)
}

export async function ingestSetupPdf(
  file: File,
  formType: FormType,
  language: string
): Promise<{ data: Record<string, unknown>; text: string; error?: string }> {
  const token = await authToken()
  if (!token) {
    return {
      data: {},
      text: '',
      error: language === 'es' ? 'Sesión expirada. Recarga la página.' : 'Session expired. Reload the page.',
    }
  }

  const body = new FormData()
  body.append('file', file)
  const response = await fetch(apiUrl('/api/parse-pdf'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  })
  const json = await response.json().catch(() => ({})) as { text?: string; error?: string }
  const text = typeof json.text === 'string' ? json.text.trim() : ''
  if (!response.ok || !text) {
    return {
      data: {},
      text: '',
      error: json.error || (language === 'es' ? 'No se pudo leer el PDF.' : 'Could not read the PDF.'),
    }
  }

  const filled = await ingestSetupText(text, formType, language)
  return { data: filled.data, text, error: filled.error }
}

export async function ingestSetupPlainFile(
  file: File,
  formType: FormType,
  language: string
): Promise<{ data: Record<string, unknown>; text: string; error?: string }> {
  const text = (await file.text()).trim()
  if (!text) {
    return {
      data: {},
      text: '',
      error: language === 'es' ? 'El archivo está vacío.' : 'The file is empty.',
    }
  }
  const filled = await ingestSetupText(text, formType, language)
  return { data: filled.data, text, error: filled.error }
}

export async function uploadSetupBrandAsset(
  file: File,
  kind: 'logo' | 'reference'
): Promise<string> {
  return uploadBrandKitAsset(file, kind)
}

export async function extractBrandFromUrl(
  url: string,
  language: string
): Promise<{ brand: Record<string, unknown> | null; error?: string }> {
  const token = await authToken()
  if (!token) {
    return {
      brand: null,
      error: language === 'es' ? 'Sesión expirada. Recarga la página.' : 'Session expired. Reload the page.',
    }
  }
  const response = await fetch(apiUrl('/api/extract-brand'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url, language }),
  })
  const json = await response.json().catch(() => ({})) as {
    success?: boolean
    brand?: Record<string, unknown>
    error?: string
  }
  if (!response.ok || !json.success || !json.brand) {
    return { brand: null, error: json.error }
  }
  return { brand: json.brand }
}

export async function analyzeSetupSite(
  url: string,
  notes: string,
  language: string
): Promise<{ analysis: SetupSiteAnalysis | null; error?: string }> {
  const token = await authToken()
  if (!token) {
    return {
      analysis: null,
      error: language === 'es' ? 'Sesión expirada. Recarga la página.' : 'Session expired. Reload the page.',
    }
  }
  const response = await fetch(apiUrl('/api/analyze-site'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ url, notes, language }),
  })
  const json = await response.json().catch(() => ({})) as {
    success?: boolean
    analysis?: SetupSiteAnalysis
    error?: string
  }
  if (!response.ok || !json.success || !json.analysis) {
    return {
      analysis: null,
      error: json.error || (language === 'es'
        ? 'No pude analizar el sitio completo.'
        : 'Could not analyze the full website.'),
    }
  }
  return { analysis: json.analysis }
}

export function appendBrandReferenceImages(existing: string[] | null | undefined, url: string): string[] {
  const next = (existing || []).filter(Boolean)
  if (!url || next.includes(url)) return next
  return [...next, url].slice(-8)
}
