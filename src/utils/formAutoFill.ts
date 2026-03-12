import { supabase } from '../lib/supabase'

const getAutoFillUrl = () => import.meta.env.PROD ? '/api/auto-fill' : 'http://localhost:3000/api/auto-fill'
const getFetchUrl = () => import.meta.env.PROD ? '/api/fetch-url' : 'http://localhost:3000/api/fetch-url'

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

async function callAutoFill(
  token: string,
  formType: FormType,
  content: string,
  language: string
): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  const res = await fetch(getAutoFillUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ formType, content, language }),
  })

  const json = await res.json()

  if (!res.ok) {
    const msg = (language === 'es' ? json.message : json.messageEn) || json.message || json.error || 'Error desconocido'
    console.error('Auto-fill API error:', res.status, json)
    return { data: null, error: msg }
  }

  if (!json.data || typeof json.data !== 'object') {
    return { data: null, error: language === 'es' ? 'Respuesta vacía de la IA' : 'Empty AI response' }
  }

  return { data: json.data }
}

async function scrapeUrl(token: string, url: string): Promise<{ content: string; title: string } | null> {
  const res = await fetch(getFetchUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ url }),
  })
  const data = await res.json()
  if (!res.ok || !data.content) return null
  return { content: data.content.slice(0, 12000), title: data.title || url }
}

export type FormType = 'business' | 'service' | 'indumentaria' | 'restaurant' | 'product' | 'real_estate'

export async function autoFillFromUrl(
  url: string,
  formType: FormType,
  language: string
): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  const token = await getToken()
  if (!token) return { data: null, error: language === 'es' ? 'Sesión expirada. Recarga la página.' : 'Session expired. Reload the page.' }

  const scraped = await scrapeUrl(token, url)
  if (!scraped) return { data: null, error: language === 'es' ? 'No se pudo extraer contenido del enlace' : 'Could not extract content from link' }

  return callAutoFill(token, formType, scraped.content, language)
}

export async function autoFillFromText(
  text: string,
  formType: FormType,
  language: string
): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  const token = await getToken()
  if (!token) return { data: null, error: language === 'es' ? 'Sesión expirada. Recarga la página.' : 'Session expired. Reload the page.' }

  return callAutoFill(token, formType, text, language)
}
