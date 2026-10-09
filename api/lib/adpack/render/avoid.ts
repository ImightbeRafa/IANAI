/**
 * Text never over the product (H4).
 *
 * The template layout is a list of nodes; nodes that touch each other form a group (a pill =
 * fill + text + icon, a card = panel + marker + text, a headline). Every group that carries
 * text or an over-layer shape and intersects the product region is moved to the nearest free
 * spot (left / right / above / below the product) inside the safe area, without colliding with
 * other groups, the logo or the product. Groups that cannot move are reported; in exact mode
 * the caller then shrinks the product box (see render.ts).
 */
import { inside, overlaps } from './frame.js'
import type { Node, TemplateLayout } from './layout.js'
import type { Box } from './types.js'

const MARGIN = 14

interface Group {
  nodes: Node[]
  box: Box
  movable: boolean
}

function unionBox(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y1 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const grow = (b: Box, m: number): Box => ({ x: b.x - m, y: b.y - m, w: b.w + m * 2, h: b.h + m * 2 })

/**
 * Nodes that matter for "text over product": text, icons and over-layer shapes (pills, cards,
 * badges). Under-layer shapes (the variant card panel, dividers) are drawn BELOW the product.
 */
export function blockingNodes(layout: TemplateLayout): Node[] {
  return layout.nodes.filter((n) => n.kind === 'text' || n.kind === 'icon' || n.layer === 'over')
}

export function groupNodes(layout: TemplateLayout): Group[] {
  const nodes = blockingNodes(layout)
  const parent = nodes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (overlaps(grow(nodes[i].box, 1), nodes[j].box)) parent[find(i)] = find(j)
    }
  }
  const map = new Map<number, Node[]>()
  nodes.forEach((n, i) => {
    const r = find(i)
    map.set(r, [...(map.get(r) ?? []), n])
  })
  return [...map.values()].map((ns) => ({ nodes: ns, box: unionBox(ns.map((n) => n.box)), movable: true }))
}

function shift(nodes: Node[], dx: number, dy: number): void {
  for (const n of nodes) n.box = { ...n.box, x: n.box.x + dx, y: n.box.y + dy }
}

const hits = (b: Box, regions: Box[]) => regions.some((r) => overlaps(b, r))

export interface AvoidResult {
  moved: number
  /** Groups still intersecting the product region. */
  conflicts: number
  conflictBoxes: Box[]
}

/**
 * Move blocking groups off `regions` (product boxes). `safe` = text-safe area,
 * `fixed` = other boxes nothing may land on (logo).
 */
export function avoidRegions(layout: TemplateLayout, regions: Box[], safe: Box, fixed: Box[] = []): AvoidResult {
  const live = regions.filter((r) => r.w > 0 && r.h > 0)
  if (!live.length) return { moved: 0, conflicts: 0, conflictBoxes: [] }
  const groups = groupNodes(layout)
  let moved = 0
  for (const g of groups) {
    if (!hits(g.box, live)) continue
    const others = groups.filter((o) => o !== g).map((o) => o.box)
    const blockers = [...others, ...fixed, ...live.map((r) => grow(r, MARGIN - 1))]
    const candidates: Array<{ dx: number; dy: number }> = []
    for (const r of live) {
      candidates.push({ dx: r.x - MARGIN - (g.box.x + g.box.w), dy: 0 })
      candidates.push({ dx: r.x + r.w + MARGIN - g.box.x, dy: 0 })
      candidates.push({ dx: 0, dy: r.y - MARGIN - (g.box.y + g.box.h) })
      candidates.push({ dx: 0, dy: r.y + r.h + MARGIN - g.box.y })
    }
    const ok = candidates
      .map((c) => ({ ...c, box: { ...g.box, x: g.box.x + c.dx, y: g.box.y + c.dy } }))
      .filter((c) => inside(c.box, safe, 1) && !hits(c.box, blockers))
      .sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)))
    if (!ok.length) continue
    shift(g.nodes, ok[0].dx, ok[0].dy)
    g.box = ok[0].box
    moved++
  }
  const left = groups.filter((g) => hits(g.box, live))
  return { moved, conflicts: left.length, conflictBoxes: left.map((g) => g.box) }
}

/** Boxes of everything drawn over the scene that is not the product (for reports / tests). */
export function overlayBoxes(layout: TemplateLayout): Box[] {
  return blockingNodes(layout).map((n) => ({ ...n.box }))
}
