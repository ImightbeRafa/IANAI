/**
 * Shared MCP approval-required payload — in-chat confirmation, neutral wording (F2).
 *
 * The host has no native MCP elicitation popup: the user confirms in chat, then the agent calls
 * confirm_execute. The payload carries a structured `approval` block
 * `{ items, unitCost, total, currency, expiresAt, summary }` (the exact plan that will run; the
 * tool re-checks it before executing and answers PLAN_CHANGED instead of degrading) and a short
 * neutral ES/EN sentence — no agent persona ("I (Grok)…"), no web link unless the caller asks for
 * the web fallback explicitly.
 */

import {
  issueMcpApprovalRequest,
  type McpApprovalStore,
} from './approval.js'

export type McpApprovalRequiredInput = {
  approvalRequestId: string
  expiresAtMs: number
  deepLink: string
  toolName: string
  quotedCreditCost: number
  creditUnit?: string
  boundInput?: Record<string, unknown>
  language?: 'es' | 'en'
  summaryEs?: string
  summaryEn?: string
  extra?: Record<string, unknown>
  /** Units in the plan (ads, images, slides…). Default 1. */
  items?: number
  /** Credits per unit. Default total / items. */
  unitCost?: number
  /** Include the web approval page as `webFallbackUrl` (only when the host cannot confirm in chat). */
  includeWebFallback?: boolean
}

/** The exact plan a user approves (F1/F2). */
export type McpApprovalPlan = {
  items: number
  unitCost: number
  total: number
  currency: 'credits'
  expiresAt: string
  summary: string
}

export async function issueMcpChatApproval(options: {
  approvalStore: McpApprovalStore
  userId: string
  toolName: string
  input: unknown
  quotedCreditCost: number
  appOrigin?: string
  language?: 'es' | 'en'
  creditUnit?: string
  summaryEs?: string
  summaryEn?: string
  extra?: Record<string, unknown>
  items?: number
  unitCost?: number
  includeWebFallback?: boolean
}): Promise<Record<string, unknown>> {
  const req = await issueMcpApprovalRequest(options.approvalStore, {
    userId: options.userId,
    toolName: options.toolName,
    input: options.input,
    quotedCreditCost: options.quotedCreditCost,
    appOrigin: options.appOrigin,
  })
  return buildMcpApprovalRequiredPayload({
    approvalRequestId: req.approvalRequestId,
    expiresAtMs: req.expiresAtMs,
    deepLink: req.deepLink,
    toolName: options.toolName,
    quotedCreditCost: options.quotedCreditCost,
    creditUnit: options.creditUnit,
    boundInput: options.input && typeof options.input === 'object'
      ? options.input as Record<string, unknown>
      : undefined,
    language: options.language,
    summaryEs: options.summaryEs,
    summaryEn: options.summaryEn,
    extra: options.extra,
    items: options.items,
    unitCost: options.unitCost,
    includeWebFallback: options.includeWebFallback,
  })
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

export function buildMcpApprovalRequiredPayload(input: McpApprovalRequiredInput): Record<string, unknown> {
  const lang = input.language === 'en' ? 'en' : 'es'
  const total = input.quotedCreditCost
  const unit = input.creditUnit || 'credits'
  const items = Math.max(1, Math.floor(input.items ?? 1))
  const unitCost = input.unitCost ?? (items ? Math.round((total / items) * 100) / 100 : total)
  const summaryEs = input.summaryEs || humanToolSummaryEs(input.toolName)
  const summaryEn = input.summaryEn || humanToolSummaryEn(input.toolName)
  const summary = lang === 'en' ? summaryEn : summaryEs
  const expiresAt = new Date(input.expiresAtMs).toISOString()
  const expiresHm = expiresAt.slice(11, 16)

  const costEs = unit !== 'credits'
    ? `${total} ${unit}`
    : total === 0
      ? 'sin costo de créditos'
      : items > 1
        ? `${items} × ${unitCost} = ${total} créditos`
        : `${total} ${plural(total, 'crédito', 'créditos')}`
  const costEn = unit !== 'credits'
    ? `${total} ${unit}`
    : total === 0
      ? 'no credit charge'
      : items > 1
        ? `${items} × ${unitCost} = ${total} credits`
        : `${total} ${plural(total, 'credit', 'credits')}`

  // Neutral, structured, no persona and no links: the host shows it as-is.
  const promptEs =
    `Confirmación requerida — Advance AI\n` +
    `Acción: ${summaryEs}\n` +
    `Costo: ${costEs}\n` +
    `Vence: ${expiresHm} UTC · un solo uso\n` +
    `Para aprobar: sí. Para cancelar: no.`
  const promptEn =
    `Confirmation required — Advance AI\n` +
    `Action: ${summaryEn}\n` +
    `Cost: ${costEn}\n` +
    `Expires: ${expiresHm} UTC · single use\n` +
    `To approve: yes. To cancel: no.`

  const approval: McpApprovalPlan = { items, unitCost, total, currency: 'credits', expiresAt, summary }

  return {
    status: 'approval_required',
    approvalSurface: 'grok_chat',
    approvalRequestId: input.approvalRequestId,
    expiresAtMs: input.expiresAtMs,
    toolName: input.toolName,
    approval,
    quotedCreditCost: total,
    creditUnit: unit,
    boundInput: input.boundInput,
    userPrompt: lang === 'en' ? promptEn : promptEs,
    userPromptEs: promptEs,
    userPromptEn: promptEn,
    instructionsForGrok:
      'Show userPrompt to the user as written (it is neutral; do not add a persona or links). ' +
      'When they say yes/approve/sí/aprobar, call confirm_execute with { approvalRequestId, action: "approve" }, ' +
      'then retry the original tool with the same arguments plus approvalRequestId. ' +
      'If the retry returns code PLAN_CHANGED, nothing ran: show the new plan and ask again (call the tool without approvalRequestId). ' +
      'If the retry returns status=running with a jobId, poll get_execute_result until status=completed (do not open a second approval). ' +
      'When they say no/cancel/deny, call confirm_execute with action "deny".',
    nextTool: 'confirm_execute',
    ...(input.includeWebFallback ? { webFallbackUrl: input.deepLink } : {}),
    message:
      lang === 'en'
        ? 'Ask the user to approve in chat (show userPrompt). Then call confirm_execute and retry with approvalRequestId.'
        : 'Pedir aprobación en el chat (mostrar userPrompt). Luego confirm_execute y reintentar con approvalRequestId.',
    ...(input.extra || {}),
  }
}

function humanToolSummaryEs(toolName: string): string {
  switch (toolName) {
    case 'execute_script_generate':
      return 'Generar un guion con Advance'
    case 'execute_image_generate':
      return 'Generar una imagen con Advance'
    case 'execute_image_edit':
      return 'Editar una imagen con Advance'
    case 'execute_image_enhance':
      return 'Mejorar (enhance) una imagen con Advance'
    case 'execute_carousel_generate':
      return 'Generar un carrusel con Advance'
    case 'execute_bulk_scripts':
      return 'Generar guiones en lote (bulk)'
    case 'execute_bulk_posts':
      return 'Generar posts en lote (bulk)'
    case 'execute_campaign_pack':
      return 'Campaign pack (ángulos + guiones + posts)'
    case 'adpack_start':
      return 'Pack de anuncios estáticos (texto + imagen por anuncio)'
    case 'adpack_regenerate':
      return 'Regenerar un anuncio del pack'
    case 'archive_brand':
      return 'Archivar una marca'
    case 'delete_offer':
      return 'Eliminar una oferta'
    case 'delete_brand':
      return 'Eliminar una marca'
    case 'delete_asset':
      return 'Eliminar un asset'
    default:
      return toolName
  }
}

function humanToolSummaryEn(toolName: string): string {
  switch (toolName) {
    case 'execute_script_generate':
      return 'Generate a script with Advance'
    case 'execute_image_generate':
      return 'Generate an image with Advance'
    case 'execute_image_edit':
      return 'Edit an image with Advance'
    case 'execute_image_enhance':
      return 'Enhance an image with Advance'
    case 'execute_carousel_generate':
      return 'Generate a carousel with Advance'
    case 'execute_bulk_scripts':
      return 'Bulk-generate scripts'
    case 'execute_bulk_posts':
      return 'Bulk-generate posts'
    case 'execute_campaign_pack':
      return 'Campaign pack (angles + scripts + posts)'
    case 'adpack_start':
      return 'Static ad pack (copy + image per ad)'
    case 'adpack_regenerate':
      return 'Regenerate one ad in the pack'
    case 'archive_brand':
      return 'Archive a brand'
    case 'delete_offer':
      return 'Delete an offer'
    case 'delete_brand':
      return 'Delete a brand'
    case 'delete_asset':
      return 'Delete an asset'
    default:
      return toolName
  }
}
