/**
 * Brand DNA orchestrator: website + Instagram + uploads in parallel with
 * per-source timeouts and partial success, then deterministic merge.
 * Runtime-agnostic (global fetch, timers only).
 */

import type { AdLanguage, BrandDna, BusinessCategory, ModelGateway } from '../types.js'
import { classifyCategory, heuristicCategory } from './classify.js'
import { ingestInstagram } from './instagram.js'
import { buildBrandDna, type OfferFormInput, type UserFactInput } from './merge.js'
import { errorMessage, withTimeout, type DnaPart, type DnaSourceEntry, type FetchLike } from './part.js'
import { ingestUploads, type UploadItem } from './uploads.js'
import { ingestWebsite, type IngestWebsiteOptions } from './website.js'

export const DNA_TOTAL_BUDGET_MS = 45_000
export const DNA_SOURCE_TIMEOUTS_MS = { website: 40_000, instagram: 25_000, uploads: 35_000 }

export interface IngestBrandDnaInput {
  gateway: ModelGateway
  websiteUrl?: string
  instagramUrl?: string
  uploads?: UploadItem[]
  offerForm?: OfferFormInput
  userFacts?: UserFactInput[]
  language?: AdLanguage
  /** Test / runtime seams. */
  fetchImpl?: FetchLike
  websiteFetchText?: IngestWebsiteOptions['fetchText']
  websiteAnalyze?: IngestWebsiteOptions['analyze']
  timeoutsMs?: Partial<typeof DNA_SOURCE_TIMEOUTS_MS>
  totalBudgetMs?: number
  now?: () => Date
}

export interface IngestBrandDnaResult {
  dna: BrandDna
  timingsMs: { website?: number; instagram?: number; uploads?: number; classify?: number; total: number }
  costUsd: number
}

type SourceKey = 'website' | 'instagram' | 'uploads'

export async function ingestBrandDna(input: IngestBrandDnaInput): Promise<IngestBrandDnaResult> {
  const clock = () => Date.now()
  const started = clock()
  const now = input.now || (() => new Date())
  const budget = Math.max(1_000, input.totalBudgetMs ?? DNA_TOTAL_BUDGET_MS)
  const timeouts = { ...DNA_SOURCE_TIMEOUTS_MS, ...(input.timeoutsMs || {}) }
  const timingsMs: IngestBrandDnaResult['timingsMs'] = { total: 0 }
  const failed: DnaSourceEntry[] = []
  const notes: string[] = []

  const run = async (key: SourceKey, kind: DnaSourceEntry['kind'], url: string | undefined, task: () => Promise<DnaPart>): Promise<DnaPart | null> => {
    const t0 = clock()
    try {
      return await withTimeout(task(), Math.min(timeouts[key], budget), key)
    } catch (err) {
      failed.push({ kind, ...(url ? { url } : {}), fetchedAt: now().toISOString(), ok: false, note: `${key} failed: ${errorMessage(err)}`.slice(0, 300) })
      return null
    } finally {
      timingsMs[key] = clock() - t0
    }
  }

  const language = input.language
  const [website, instagram, uploads] = await Promise.all([
    input.websiteUrl
      ? run('website', 'website', input.websiteUrl, () => ingestWebsite({
        url: input.websiteUrl as string,
        gateway: input.gateway,
        language,
        fetchText: input.websiteFetchText,
        analyze: input.websiteAnalyze,
        now,
      }))
      : Promise.resolve(null),
    input.instagramUrl
      ? run('instagram', 'instagram', input.instagramUrl, () => ingestInstagram({
        url: input.instagramUrl as string,
        gateway: input.gateway,
        fetchImpl: input.fetchImpl,
        language,
        now,
      }))
      : Promise.resolve(null),
    input.uploads?.length
      ? run('uploads', 'upload', undefined, () => ingestUploads({ items: input.uploads as UploadItem[], gateway: input.gateway, language, now }))
      : Promise.resolve(null),
  ])

  if (!website && !instagram && !uploads && !input.offerForm && !input.userFacts?.length) {
    notes.push('no source produced data — add facts manually or upload references')
  }

  let costUsd = (website?.costUsd || 0) + (instagram?.costUsd || 0) + (uploads?.costUsd || 0)

  // Category: heuristics inside merge; LLM fallback only when inconclusive and time remains.
  const draft = buildBrandDna({ website, instagram, uploads, offerForm: input.offerForm, userFacts: input.userFacts, language, extraSources: failed, extraNotes: notes })
  let category: BusinessCategory | undefined
  const sample = [draft.brandName, draft.oneLiner, ...draft.facts.map((f) => f.value), website?.textSample, instagram?.textSample, uploads?.textSample]
    .filter(Boolean)
    .join('\n')
  const remaining = budget - (clock() - started)
  if (!heuristicCategory(sample) && remaining > 2_000) {
    const t0 = clock()
    try {
      const verdict = await withTimeout(classifyCategory({ text: sample, gateway: input.gateway, language: draft.language }), Math.min(8_000, remaining - 500), 'classify')
      category = verdict.category
      costUsd += verdict.costUsd
    } catch {
      // keep heuristic default from the draft
    } finally {
      timingsMs.classify = clock() - t0
    }
  }

  const dna = category && category !== draft.category
    ? buildBrandDna({ website, instagram, uploads, offerForm: input.offerForm, userFacts: input.userFacts, language, category, extraSources: failed, extraNotes: notes })
    : draft
  timingsMs.total = clock() - started
  return { dna, timingsMs, costUsd: Math.round(costUsd * 1e6) / 1e6 }
}
