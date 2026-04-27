import type { ProductType, ScriptFramework } from './types.js'

interface MemoryFilterInput {
  styleMemoryPrompt?: string
  scriptTemplatesPrompt?: string
  productType?: ProductType
  requestedTypes: ScriptFramework[]
}

function lineSeemsRelevant(line: string, terms: string[]): boolean {
  const lower = line.toLowerCase()
  return terms.some(term => lower.includes(term.toLowerCase()))
}

export function injectRelevantScriptMemory(input: MemoryFilterInput): { memoryPrompt: string; templatePrompt: string } {
  const terms = [
    input.productType || '',
    ...input.requestedTypes,
    'anti',
    'nunca',
    'never',
    'rule',
    'regla',
    'hook',
    'gancho',
    'cta',
    'tone',
    'tono',
  ].filter(Boolean)

  const memoryLines = (input.styleMemoryPrompt || '')
    .split('\n')
    .filter(line => line.trim().length > 0)
  const templateLines = (input.scriptTemplatesPrompt || '')
    .split('\n')
    .filter(line => line.trim().length > 0)

  const memoryPrompt = memoryLines
    .filter(line => lineSeemsRelevant(line, terms) || line.includes('===') || line.startsWith('•'))
    .slice(0, 80)
    .join('\n')

  const templatePrompt = templateLines
    .filter(line => lineSeemsRelevant(line, terms) || line.startsWith('---'))
    .slice(0, 80)
    .join('\n')

  return { memoryPrompt, templatePrompt }
}

