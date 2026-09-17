/**
 * Tolerant script-batch parser (canonical text v2 + legacy clustered blobs).
 * Byte-identical mirror lives at src/utils/scriptSections.ts — do not import api/ from src/.
 */

export type ScriptSectionKind = 'gancho' | 'desarrollo' | 'cierre' | 'other'
export type CloseLabel = 'CTA' | 'CIERRE' | 'CLOSE'
export type ScriptFramework =
  | 'venta_directa'
  | 'desvalidar_alternativas'
  | 'mostrar_servicio'
  | 'variedad_productos'
  | 'paso_a_paso'
  | 'reconocimiento'
  | 'educativo'
  | 'storytelling'
  | 'tendencia'
  | 'engagement'

export interface ParsedScriptSection {
  kind: ScriptSectionKind
  label: string
  displayLabel: string
  text: string
  seconds: number | null
}

export interface ParsedScriptOption {
  index: number
  title: string
  scriptTypeLabel: string
  headerLine: string
  sections: ParsedScriptSection[]
  content: string
  totalSeconds: number
}

export interface ScriptSectionBlock {
  kind?: ScriptSectionKind
  label: string
  text: string
  seconds: number
}

export interface ScriptSectionsDto {
  index: number
  title: string
  scriptType: ScriptFramework
  scriptTypeLabel: string
  hook: ScriptSectionBlock
  development: ScriptSectionBlock
  close: { label: CloseLabel; text: string; seconds: number }
  totalSeconds: number
  content: string
}

const HEADER_RE =
  /^(?:\*{0,2})(?:#{1,6}\s*)?(?:\*{0,2})(?:GUI[OÓ]N(?:\s*\/\s*OPCI[OÓ]N)?|OPCI[OÓ]N|OPTION|SCRIPT|Gui[oó]n|Script|Opci[oó]n)\s*#?\s*(\d+)\s*[:\-—–.]?\s*(.*?)(?:\*{0,2})$/gim

const SECTION_MARKER_RE =
  /\[(GANCHO|HOOK|DESARROLLO|DEVELOPMENT|CTA|CIERRE|CLOSE)S?(?:\s*[AB])?(?:\s*[-–—·:]\s*[^\]]*)?\]:?/gi

function displayLabelForKind(kind: ScriptSectionKind): string {
  switch (kind) {
    case 'gancho':
      return 'Gancho'
    case 'desarrollo':
      return 'Desarrollo'
    case 'cierre':
      return 'Cierre'
    case 'other':
      return ''
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

function classifyMarkerKey(rawInner: string): ScriptSectionKind {
  const key = rawInner
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim()
    .toUpperCase()
    .replace(/\s+[AB]$/, '')
    .replace(/\s*[-–—·:].*$/, '')
  if (key.startsWith('GANCHO') || key.startsWith('HOOK')) return 'gancho'
  if (key.startsWith('DESARROLLO') || key.startsWith('DEVELOPMENT')) return 'desarrollo'
  if (key === 'CTA' || key.startsWith('CIERRE') || key.startsWith('CLOSE')) return 'cierre'
  return 'other'
}

function canonicalMarkerLabel(kind: ScriptSectionKind, language: 'es' | 'en', closeLabel?: CloseLabel): string {
  switch (kind) {
    case 'gancho':
      return language === 'en' ? 'HOOK' : 'GANCHO'
    case 'desarrollo':
      return language === 'en' ? 'DEVELOPMENT' : 'DESARROLLO'
    case 'cierre':
      return closeLabel || (language === 'en' ? 'CLOSE' : 'CTA')
    case 'other':
      return ''
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

export function extractSecondsFromMarker(raw: string): number | null {
  const inner = raw.replace(/^\[/, '').replace(/\]:?$/, '')
  const match = inner.match(/(\d+(?:[.,]\d+)?)\s*(?:s|seg|secs?|seconds?)?\b/i)
  if (!match) return null
  const n = Number(String(match[1]).replace(',', '.'))
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round(n))
}

export function normalizeScriptText(text: string): string {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/^(?:#{1,6}\s*|\*{1,2}\s*)+(?=(?:GUI[OÓ]N|OPCI[OÓ]N|OPTION|SCRIPT))/gim, '')
    .replace(/\*{1,2}\s*$/gm, '')
    .replace(/\]:\s*/g, ']\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseHeaderTail(tail: string): { title: string; scriptTypeLabel: string } {
  const trimmed = (tail || '').trim()
  const estilo = trimmed.match(/\[Estilo:\s*([^\]]+)\]/i)
  let scriptTypeLabel = estilo?.[1]?.trim() || ''
  let rest = trimmed.replace(/\[Estilo:\s*[^\]]+\]/ig, '')
  rest = rest.replace(/\s*[-–—]\s*/g, ' — ').replace(/^\s*—\s*|\s*—\s*$/g, '').trim()
  const quoted = rest.match(/[“"«]([^”"»]+)[”"»]/)
  if (quoted) {
    const title = quoted[1].trim()
    if (!scriptTypeLabel) {
      const before = rest.slice(0, quoted.index).replace(/[—–-]/g, ' ').trim()
      if (before) scriptTypeLabel = before.replace(/^—\s*/, '').trim()
    }
    return { title, scriptTypeLabel }
  }
  const parts = rest.split(/\s*—\s*/).map((part) => part.replace(/^["']|["']$/g, '').trim()).filter(Boolean)
  if (!scriptTypeLabel && parts.length >= 2) {
    scriptTypeLabel = parts[0]
    return { title: parts.slice(1).join(' — '), scriptTypeLabel }
  }
  return { title: parts.join(' — ') || rest, scriptTypeLabel }
}

export function parseScriptSectionsFromText(text: string): ParsedScriptSection[] {
  const source = normalizeScriptText(text)
  if (!source) return []
  const matches = [...source.matchAll(SECTION_MARKER_RE)]
  if (matches.length === 0) {
    return [{
      kind: 'other',
      label: '',
      displayLabel: '',
      text: source.trim(),
      seconds: null,
    }]
  }

  const sections: ParsedScriptSection[] = []
  const firstIndex = matches[0].index ?? 0
  const leading = source.slice(0, firstIndex).trim()
  if (leading) {
    sections.push({
      kind: 'other',
      label: '',
      displayLabel: '',
      text: leading.replace(/^#{1,6}\s*/, '').trim(),
      seconds: null,
    })
  }

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]
    const start = (match.index ?? 0) + match[0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? source.length) : source.length
    const rawBody = source.slice(start, end).replace(/^\s*\n/, '').trim()
    const kind = classifyMarkerKey(match[1] || match[0])
    sections.push({
      kind,
      label: canonicalMarkerLabel(kind, /HOOK|DEVELOPMENT|CLOSE/i.test(match[1] || '') ? 'en' : 'es'),
      displayLabel: displayLabelForKind(kind),
      text: rawBody.replace(/^:\s*/, '').trim(),
      seconds: extractSecondsFromMarker(match[0]),
    })
  }
  return sections
}

function renderOptionContent(option: {
  index: number
  title: string
  scriptTypeLabel: string
  sections: ParsedScriptSection[]
  language?: 'es' | 'en'
}): string {
  const language = option.language || 'es'
  const type = option.scriptTypeLabel || (language === 'es' ? 'Guion' : 'Script')
  const title = option.title ? `"${option.title.replace(/^["“]|["”]$/g, '')}"` : ''
  const header = `${language === 'en' ? 'OPTION' : 'OPCIÓN'} #${option.index} — ${type}${title ? ` — ${title}` : ''}`
  const blocks = option.sections
    .filter((section) => section.kind !== 'other' || section.text)
    .map((section) => {
      if (section.kind === 'other') return section.text
      const seconds = section.seconds != null ? ` · ~${section.seconds} s` : ''
      return `[${section.label}${seconds}]\n${section.text}`.trim()
    })
  return [header, ...blocks].join('\n\n').trim()
}

export function parseScriptBatch(text: string, language: 'es' | 'en' = 'es'): ParsedScriptOption[] {
  const source = normalizeScriptText(text)
  if (!source) return []

  const headers: { index: number; pos: number; title: string; scriptTypeLabel: string; raw: string }[] = []
  HEADER_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = HEADER_RE.exec(source)) !== null) {
    const tail = parseHeaderTail(match[2] || '')
    headers.push({
      index: parseInt(match[1], 10),
      pos: match.index,
      title: tail.title,
      scriptTypeLabel: tail.scriptTypeLabel,
      raw: match[0],
    })
  }

  const blocks: { index: number; title: string; scriptTypeLabel: string; headerLine: string; body: string }[] =
    headers.length >= 1
      ? headers.map((header, i) => {
        const start = header.pos
        const end = i + 1 < headers.length ? headers[i + 1].pos : source.length
        const full = source.slice(start, end).trim()
        const firstNewline = full.indexOf('\n')
        const body = firstNewline > -1 ? full.slice(firstNewline + 1).trim() : ''
        return {
          index: header.index,
          title: header.title,
          scriptTypeLabel: header.scriptTypeLabel,
          headerLine: header.raw.trim(),
          body,
        }
      })
      : [{
        index: 1,
        title: '',
        scriptTypeLabel: '',
        headerLine: '',
        body: source,
      }]

  return blocks.map((block) => {
    const sections = parseScriptSectionsFromText(block.body || block.headerLine)
    const meaningful = sections.filter((section) => section.kind !== 'other' || section.text)
    const totalSeconds = meaningful.reduce((sum, section) => sum + (section.seconds || 0), 0)
    const title = block.title || meaningful.find((section) => section.kind === 'gancho')?.text.slice(0, 80) || `Script ${block.index}`
    const option: ParsedScriptOption = {
      index: block.index || 1,
      title,
      scriptTypeLabel: block.scriptTypeLabel,
      headerLine: block.headerLine,
      sections: meaningful,
      content: '',
      totalSeconds,
    }
    option.content = block.headerLine
      ? renderOptionContent({
        index: option.index,
        title: option.title,
        scriptTypeLabel: option.scriptTypeLabel,
        sections: option.sections,
        language,
      })
      : source
    return option
  })
}

export function labeledCopyText(option: ParsedScriptOption, language: 'es' | 'en' = 'es'): string {
  return renderOptionContent({
    index: option.index,
    title: option.title,
    scriptTypeLabel: option.scriptTypeLabel,
    sections: option.sections,
    language,
  })
}

export function bodyOnlyCopyText(option: ParsedScriptOption): string {
  return option.sections
    .map((section) => section.text)
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

export function inferScriptTypeFromLabel(label: string): ScriptFramework {
  const n = (label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (n.includes('desvalidar') || n.includes('invalidate')) return 'desvalidar_alternativas'
  if (n.includes('mostrar') || n.includes('show service')) return 'mostrar_servicio'
  if (n.includes('variedad') || n.includes('variety')) return 'variedad_productos'
  if (n.includes('paso') || n.includes('step')) return 'paso_a_paso'
  if (n.includes('reconoc') || n.includes('awareness')) return 'reconocimiento'
  if (n.includes('educativ') || n.includes('educational')) return 'educativo'
  if (n.includes('story')) return 'storytelling'
  if (n.includes('tendenc') || n.includes('trend')) return 'tendencia'
  if (n.includes('engagement')) return 'engagement'
  return 'venta_directa'
}

function closeLabelFromSection(section: ParsedScriptSection | undefined, language: 'es' | 'en'): CloseLabel {
  const raw = (section?.label || '').toUpperCase()
  if (raw === 'CIERRE' || raw === 'CLOSE' || raw === 'CTA') return raw as CloseLabel
  return language === 'en' ? 'CLOSE' : 'CTA'
}

export function parsedOptionsToSectionDtos(
  options: ParsedScriptOption[],
  language: 'es' | 'en' = 'es'
): ScriptSectionsDto[] {
  return options.map((option) => {
    const hook = option.sections.find((s) => s.kind === 'gancho')
    const development = option.sections.find((s) => s.kind === 'desarrollo')
    const close = option.sections.find((s) => s.kind === 'cierre')
    const scriptType = inferScriptTypeFromLabel(option.scriptTypeLabel)
    return {
      index: option.index,
      title: option.title,
      scriptType,
      scriptTypeLabel: option.scriptTypeLabel || (language === 'es' ? 'Guion' : 'Script'),
      hook: {
        label: language === 'en' ? 'HOOK' : 'GANCHO',
        text: hook?.text || '',
        seconds: hook?.seconds || 0,
      },
      development: {
        label: language === 'en' ? 'DEVELOPMENT' : 'DESARROLLO',
        text: development?.text || '',
        seconds: development?.seconds || 0,
      },
      close: {
        label: closeLabelFromSection(close, language),
        text: close?.text || '',
        seconds: close?.seconds || 0,
      },
      totalSeconds: option.totalSeconds,
      content: option.content,
    }
  })
}

export function sectionsFromStoredContent(content: string, language: 'es' | 'en' = 'es'): ScriptSectionsDto[] {
  return parsedOptionsToSectionDtos(parseScriptBatch(content, language), language)
}

export function dtoToParsedOption(dto: ScriptSectionsDto): ParsedScriptOption {
  const sections: ParsedScriptSection[] = [
    {
      kind: 'gancho',
      label: dto.hook.label,
      displayLabel: displayLabelForKind('gancho'),
      text: dto.hook.text,
      seconds: dto.hook.seconds,
    },
    {
      kind: 'desarrollo',
      label: dto.development.label,
      displayLabel: displayLabelForKind('desarrollo'),
      text: dto.development.text,
      seconds: dto.development.seconds,
    },
    {
      kind: 'cierre',
      label: dto.close.label,
      displayLabel: displayLabelForKind('cierre'),
      text: dto.close.text,
      seconds: dto.close.seconds,
    },
  ]
  return {
    index: dto.index,
    title: dto.title,
    scriptTypeLabel: dto.scriptTypeLabel,
    headerLine: '',
    sections,
    content: dto.content,
    totalSeconds: dto.totalSeconds,
  }
}
