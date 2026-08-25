/**
 * Shared MCP approval-required payload — Grok-chat first, web page optional fallback.
 * Grok has no native MCP elicitation popup; users confirm in chat, then Grok calls confirm_execute.
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
  })
}

export function buildMcpApprovalRequiredPayload(input: McpApprovalRequiredInput): Record<string, unknown> {
  const lang = input.language === 'en' ? 'en' : 'es'
  const cost = input.quotedCreditCost
  const unit = input.creditUnit || 'credits'
  const summary =
    lang === 'en'
      ? (input.summaryEn || humanToolSummaryEn(input.toolName))
      : (input.summaryEs || humanToolSummaryEs(input.toolName))

  const costLabelEs = unit === 'credits'
    ? (cost === 0 ? 'sin costo de créditos' : `${cost} créditos IA`)
    : `${cost} ${unit}`
  const costLabelEn = unit === 'credits'
    ? (cost === 0 ? 'no credit charge' : `${cost} AI credits`)
    : `${cost} ${unit}`

  const promptEs =
    `**Advance AI — confirmación requerida**\n\n` +
    `Voy a ejecutar: **${summary}**\n` +
    `Costo estimado: **${costLabelEs}**\n` +
    `Válido ~1 hora · un solo uso.\n\n` +
    `Si estás de acuerdo, respondé **sí** o **aprobar**.\n` +
    `Si no, respondé **no** o **cancelar**.\n\n` +
    `Yo (Grok) llamaré la herramienta \`confirm_execute\` con tu decisión y luego reintentaré la acción. ` +
    `No necesitas abrir ningún link.`

  const promptEn =
    `**Advance AI — confirmation required**\n\n` +
    `I'm about to run: **${summary}**\n` +
    `Estimated cost: **${costLabelEn}**\n` +
    `Valid ~1 hour · single use.\n\n` +
    `If you agree, reply **yes** or **approve**.\n` +
    `If not, reply **no** or **cancel**.\n\n` +
    `I (Grok) will call \`confirm_execute\` with your decision, then retry the action. ` +
    `You do not need to open any link.`

  return {
    status: 'approval_required',
    approvalSurface: 'grok_chat',
    approvalRequestId: input.approvalRequestId,
    expiresAtMs: input.expiresAtMs,
    toolName: input.toolName,
    quotedCreditCost: cost,
    creditUnit: unit,
    boundInput: input.boundInput,
    // Primary UX for Grok — show this to the user, do not dump raw URLs
    userPrompt: lang === 'en' ? promptEn : promptEs,
    userPromptEs: promptEs,
    userPromptEn: promptEn,
    instructionsForGrok:
      'Show userPrompt to the user as a clear confirmation message. Do NOT paste optionalAdvancePage or any raw URL unless the user explicitly asks for the Advance web fallback. ' +
      'When they say yes/approve/sí/aprobar, call confirm_execute with { approvalRequestId, action: "approve" }, ' +
      'then retry the original tool with the same arguments plus approvalRequestId. ' +
      'If the retry returns status=running with a jobId, poll get_execute_result until status=completed (do not open a second approval). ' +
      'When they say no/cancel/deny, call confirm_execute with action "deny".',
    nextTool: 'confirm_execute',
    // Optional fallback only — never the primary message
    optionalAdvancePage: input.deepLink,
    message:
      lang === 'en'
        ? 'Ask the user in chat to approve (show userPrompt). Then call confirm_execute, then retry with approvalRequestId. Do not lead with a URL.'
        : 'Pedí aprobación en el chat (mostrá userPrompt). Luego llamá confirm_execute y reintentá con approvalRequestId. No uses un URL como mensaje principal.',
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
