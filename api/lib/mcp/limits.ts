/**
 * MCP-only generation caps (web endpoints keep higher limits).
 */

export const MCP_BULK_COUNT_HARD_MAX = 10
export const MCP_CAROUSEL_SLIDE_HARD_MAX = 5

export function assertMcpBulkCount(count: number, webMax: number): number {
  const n = Math.round(Number(count))
  if (!Number.isFinite(n) || n < 1) throw new Error('count must be a positive integer')
  const cap = Math.min(MCP_BULK_COUNT_HARD_MAX, webMax)
  if (n > cap) {
    throw new Error(`MCP bulk count max is ${cap} (requested ${n}). Use smaller batches.`)
  }
  return n
}

export function assertMcpCarouselSlideCount(count: number, webMax: number): number {
  const n = Math.round(Number(count))
  if (!Number.isFinite(n) || n < 2) throw new Error('slideCount must be between 2 and MCP max')
  const cap = Math.min(MCP_CAROUSEL_SLIDE_HARD_MAX, webMax)
  if (n > cap) {
    throw new Error(`MCP carousel slideCount max is ${cap} (requested ${n}). Prefer previewFirstSlideOnly or smaller batches.`)
  }
  return n
}
