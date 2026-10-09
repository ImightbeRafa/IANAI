/**
 * Shared harness for the two Ad Pack doors (web handler + MCP dispatch):
 * memory store, fake gateway / renderer / storage / charge / credit check,
 * captured background work, mocked req/res.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { CREDIT_WEIGHTS } from '../../api/lib/credits/catalog'
import { createAdPackService, type AdPackChargeInput, type AdPackDeps, type AdPackService, type AdPackUsageEntry } from '../../api/lib/adpack/service'
import { createMemoryPackStore, type MemoryPackStore } from '../../api/lib/adpack/store-memory'
import type { IngestBrandDnaInput } from '../../api/lib/adpack/dna/ingest'
import type { AdPackLibrary } from '../../api/lib/adpack/library'
import type { SavedBrandDb } from '../../api/lib/adpack/saved-brand'
import { createMemoryMcpApprovalStore, type McpApprovalStore } from '../../api/lib/mcp/approval'
import { handleMcpJsonRpc } from '../../api/lib/mcp/protocol'
import type { McpDbClient } from '../../api/lib/mcp/user-tools'
import { caseById } from './helpers'
import { fakeImageLoader, fakeRenderer, fakeStorage, runnerGateway, type RunnerGateway, type RunnerGatewayOptions } from './runner-fakes'

export const USER_A = '00000000-0000-4000-8000-00000000000a'
export const USER_B = '00000000-0000-4000-8000-00000000000b'
export const PER_AD = CREDIT_WEIGHTS.image_standard

export const serum = caseById('beauty-serum')

export interface DoorEnv {
  store: MemoryPackStore
  gateway: RunnerGateway
  renderer: ReturnType<typeof fakeRenderer>
  storage: ReturnType<typeof fakeStorage>
  charges: AdPackChargeInput[]
  logs: AdPackUsageEntry[]
  ingestCalls: IngestBrandDnaInput[]
  credits: { remaining: number }
  service: AdPackService
}

export function createDoorEnv(
  options: {
    credits?: number
    ownedIds?: string[]
    savedBrandDb?: SavedBrandDb
    library?: AdPackLibrary
    /** Vision verdicts (scene checks and the style-DNA analysis). */
    vision?: RunnerGatewayOptions['vision']
    saveStyleDnaAnalysis?: AdPackDeps['saveStyleDnaAnalysis']
  } = {},
): DoorEnv {
  const store = createMemoryPackStore()
  const gateway = runnerGateway(options.vision ? { vision: options.vision } : {})
  const renderer = fakeRenderer()
  const storage = fakeStorage()
  const charges: AdPackChargeInput[] = []
  const logs: AdPackUsageEntry[] = []
  const ingestCalls: IngestBrandDnaInput[] = []
  const credits = { remaining: options.credits ?? 10_000 }
  const service = createAdPackService({
    store,
    gateway,
    renderer,
    storage,
    async charge(input) {
      // Idempotent by generationId, like consumeCredits.
      if (charges.some((c) => c.generationId === input.generationId)) return { charged: false }
      charges.push(input)
      credits.remaining -= PER_AD
      return { charged: true, credits: PER_AD }
    },
    async checkCredits({ ads }) {
      const required = ads * PER_AD
      return { allowed: credits.remaining >= required, remaining: credits.remaining, creditsRequired: required }
    },
    async logUsage(entry) {
      logs.push(entry)
    },
    async verifyLinks({ businessId, brandKitId }) {
      const owned = options.ownedIds ?? []
      return [businessId, brandKitId].every((id) => !id || owned.includes(id))
    },
    async ingest(input) {
      ingestCalls.push(input)
      return { dna: structuredClone(serum.dna), costUsd: 0.004, timingsMs: { website: 5, total: 6 } }
    },
    ...(options.savedBrandDb ? { savedBrandDb: options.savedBrandDb } : {}),
    ...(options.library ? { library: options.library } : {}),
    // Exact mode (default with a product photo) loads photos: synthetic, no network.
    loadImage: fakeImageLoader(),
    ...(options.saveStyleDnaAnalysis ? { saveStyleDnaAnalysis: options.saveStyleDnaAnalysis } : {}),
  })
  return { store, gateway, renderer, storage, charges, logs, ingestCalls, credits, service }
}

// ---------------------------------------------------------------------------
// Web door
// ---------------------------------------------------------------------------

export interface MockRes {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  ended: boolean
}

export function mockReqRes(input: { method?: string; body?: unknown; userId?: string | null }) {
  const req = {
    method: input.method ?? 'POST',
    headers: input.userId ? { authorization: `Bearer test:${input.userId}` } : {},
    body: input.body,
  } as unknown as VercelRequest
  const state: MockRes = { statusCode: 200, body: undefined, headers: {}, ended: false }
  const res = {
    setHeader(key: string, value: string) {
      state.headers[key] = value
      return res
    },
    status(code: number) {
      state.statusCode = code
      return res
    },
    json(body: unknown) {
      state.body = body
      state.ended = true
      return res
    },
    end() {
      state.ended = true
      return res
    },
  } as unknown as VercelResponse
  return { req, res, state }
}

export type WebHandler = (req: VercelRequest, res: VercelResponse) => Promise<unknown>

export async function callWeb(handler: WebHandler, userId: string | null, body: Record<string, unknown>): Promise<MockRes> {
  const { req, res, state } = mockReqRes({ body, userId })
  await handler(req, res)
  return state
}

// ---------------------------------------------------------------------------
// MCP door
// ---------------------------------------------------------------------------

export const mcpDb = {} as McpDbClient

export interface McpCallResult {
  isError: boolean
  payload: Record<string, unknown>
}

export async function callMcp(env: { service: AdPackService; approvalStore: McpApprovalStore }, userId: string, name: string, args: Record<string, unknown>): Promise<McpCallResult> {
  const rpc = await handleMcpJsonRpc({
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    user: { id: userId },
    db: mcpDb,
    approvalStore: env.approvalStore,
    adPackService: env.service,
  })
  if (rpc.error) throw new Error(`rpc error: ${rpc.error.message}`)
  const result = rpc.result as { content: Array<{ text: string }>; isError: boolean }
  return { isError: result.isError, payload: JSON.parse(result.content[0].text) as Record<string, unknown> }
}

/** adpack_start through the in-chat approval: prompt → confirm_execute → retry. */
export async function mcpStartApproved(env: { service: AdPackService; approvalStore: McpApprovalStore }, userId: string, args: Record<string, unknown>) {
  const prompt = await callMcp(env, userId, 'adpack_start', args)
  if (prompt.payload.status !== 'approval_required') throw new Error(`expected approval_required, got ${JSON.stringify(prompt.payload).slice(0, 300)}`)
  const approvalRequestId = String(prompt.payload.approvalRequestId)
  const confirm = await callMcp(env, userId, 'confirm_execute', { approvalRequestId, action: 'approve' })
  if (confirm.isError) throw new Error(`confirm failed: ${JSON.stringify(confirm.payload)}`)
  const started = await callMcp(env, userId, 'adpack_start', { ...args, approvalRequestId })
  return { prompt, approvalRequestId, started }
}

export { createMemoryMcpApprovalStore }
