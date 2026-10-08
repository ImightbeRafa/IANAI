/**
 * SPA client for POST /api/ad-pack (same base URL + Bearer token as the bulk helpers).
 * Types come from the server contract via `import type` only — nothing server-side is bundled.
 */
import type {
  AdPackAction,
  AdPackAnglesRequest,
  AdPackAnglesResponse,
  AdPackCancelRequest,
  AdPackCancelResponse,
  AdPackConfirmDnaRequest,
  AdPackConfirmDnaResponse,
  AdPackEditTextRequest,
  AdPackEditTextResponse,
  AdPackErrorBody,
  AdPackErrorCode,
  AdPackIngestDnaRequest,
  AdPackIngestDnaResponse,
  AdPackQuote,
  AdPackQuoteRequest,
  AdPackRegenerateRequest,
  AdPackRegenerateResponse,
  AdPackStartRequest,
  AdPackStartResponse,
  AdPackStatusRequest,
  AdPackStatusResponse,
} from '../../../api/lib/adpack/http-types'
import { authHeaders, bulkApiUrl } from './chatShellBulk'

export type * from '../../../api/lib/adpack/http-types'

export class AdPackApiError extends Error {
  readonly code: AdPackErrorCode | 'HTTP_ERROR'
  readonly status: number
  readonly body: Partial<AdPackErrorBody>
  constructor(status: number, body: Partial<AdPackErrorBody>) {
    super(body.error || `Request failed (${status})`)
    this.name = 'AdPackApiError'
    this.status = status
    this.code = body.code || 'HTTP_ERROR'
    this.body = body
  }
}

async function call<T>(action: AdPackAction, body: object): Promise<T> {
  const response = await fetch(bulkApiUrl('ad-pack'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ ...body, action }),
  })
  const json = await response.json().catch(() => ({})) as T & Partial<AdPackErrorBody>
  if (!response.ok) throw new AdPackApiError(response.status, json)
  return json
}

export function adPackIngestDna(body: AdPackIngestDnaRequest): Promise<AdPackIngestDnaResponse> {
  return call('dna_ingest', body)
}

export function adPackConfirm(body: AdPackConfirmDnaRequest): Promise<AdPackConfirmDnaResponse> {
  return call('dna_confirm', body)
}

export function adPackAngles(body: AdPackAnglesRequest): Promise<AdPackAnglesResponse> {
  return call('angles', body)
}

export function adPackQuote(body: AdPackQuoteRequest): Promise<AdPackQuote> {
  return call('quote', body)
}

export function adPackStart(body: AdPackStartRequest): Promise<AdPackStartResponse> {
  return call('start', body)
}

/** Poll every few seconds while `moreWork`; each poll also resumes the pack server-side. */
export function adPackStatus(body: AdPackStatusRequest): Promise<AdPackStatusResponse> {
  return call('status', body)
}

export function adPackEditText(body: AdPackEditTextRequest): Promise<AdPackEditTextResponse> {
  return call('edit_text', body)
}

export function adPackRegenerate(body: AdPackRegenerateRequest): Promise<AdPackRegenerateResponse> {
  return call('regenerate', body)
}

export function adPackCancel(body: AdPackCancelRequest): Promise<AdPackCancelResponse> {
  return call('cancel', body)
}

/** Injectable client surface (the studio takes one; the DEV harness passes a mock). */
export interface AdPackClient {
  ingestDna: typeof adPackIngestDna
  confirm: typeof adPackConfirm
  angles: typeof adPackAngles
  quote: typeof adPackQuote
  start: typeof adPackStart
  status: typeof adPackStatus
  editText: typeof adPackEditText
  regenerate: typeof adPackRegenerate
  cancel: typeof adPackCancel
}

export const adPackClient: AdPackClient = {
  ingestDna: adPackIngestDna,
  confirm: adPackConfirm,
  angles: adPackAngles,
  quote: adPackQuote,
  start: adPackStart,
  status: adPackStatus,
  editText: adPackEditText,
  regenerate: adPackRegenerate,
  cancel: adPackCancel,
}
