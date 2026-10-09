/**
 * Ad Pack engine — category compliance rule packs.
 *
 * Conservative, generic rules inspired by public ad policies (personal health,
 * weight loss, prescription drugs, financial claims, misleading claims). The
 * checker is deterministic: regex packs per language, scoped by category.
 */
import type { AdFormat, AdLanguage, BusinessCategory, DnaFact, FactKey } from './types.js'
import { extractNumericClaims, numbersInFacts } from './facts.js'
import { normalizeText } from './util.js'

export type ComplianceSeverity = 'block' | 'warn'

export interface ComplianceRule {
  id: string
  /** 'all' = applies to every category. */
  categories: BusinessCategory[] | 'all'
  severity: ComplianceSeverity
  /** Patterns run against accent-stripped lowercase text. */
  patterns: Record<AdLanguage, RegExp[]>
  detail: Record<AdLanguage, string>
  /** Suppressed when a confirmed fact with one of these keys backs every number in the match. */
  exemptIfFactKeys?: FactKey[]
}

export interface ComplianceIssue {
  ruleId: string
  severity: ComplianceSeverity
  match: string
  detail: string
}

const DISEASES_ES =
  '(?:diabetes|cancer|ansiedad|depresion|artritis|acne|hipertension|presion alta|colesterol|insomnio|migran[as]+|asma|gastritis|colitis|enfermedad(?:es)?|infeccion(?:es)?|covid|psoriasis|dermatitis|rosacea|alopecia|caida del cabello|tiroides|obesidad)'
const DISEASES_EN =
  '(?:diabetes|cancer|anxiety|depression|arthritis|acne|hypertension|high blood pressure|cholesterol|insomnia|migraines?|asthma|disease|diseases|infections?|covid|psoriasis|eczema|rosacea|hair loss|thyroid|obesity)'

export const COMPLIANCE_RULES: ComplianceRule[] = [
  // --- Round 1c: functional / physiological promises (health, fitness, beauty) ---------------------
  {
    id: 'health_pain_promise',
    categories: ['health_wellness', 'fitness_sports', 'beauty'],
    severity: 'block',
    patterns: {
      es: [/\b(?:desaparicion|desaparece|desaparecen|desaparecer|eliminacion|elimina|eliminar|adios(?: al)?|fin (?:del|al)|se acabo el)\s+(?:del?\s+|al\s+|el\s+|tu\s+|los\s+|las\s+)?(?:dolor|dolores|molestias?)\b/],
      en: [/\b(?:eliminates?|ends?|gets? rid of|no more|says? goodbye to)\s+(?:your\s+)?(?:back\s+|neck\s+)?(?:pain|aches?)\b/],
    },
    detail: {
      es: 'No prometas que el dolor desaparece: es una promesa médica. Decí qué hace el producto (soporte, ajuste, material).',
      en: 'Do not promise the pain goes away: it is a medical promise. Say what the product does (support, fit, material).',
    },
  },
  {
    id: 'health_immediate_lasting_result',
    categories: ['health_wellness', 'fitness_sports', 'beauty'],
    severity: 'block',
    patterns: {
      es: [/\b(?:correccion|resultados?|alivio|mejora|efecto)\s+(?:inmediat[oa]s?|instantane[oa]s?)\b/, /\binmediat[oa]s?\s+y\s+duradera?s?\b/, /\b(?:resultados?|efectos?)\s+(?:permanentes|garantizados?|para siempre)\b/],
      en: [/\b(?:immediate|instant)\s+(?:and\s+lasting\s+)?(?:correction|results?|relief)\b/, /\b(?:permanent|guaranteed)\s+results?\b/],
    },
    detail: {
      es: 'Sin promesas de resultado inmediato, duradero o garantizado en salud/cuerpo.',
      en: 'No immediate, lasting or guaranteed outcome promises about health/body.',
    },
  },
  {
    id: 'physiological_claim',
    categories: ['health_wellness', 'fitness_sports', 'beauty'],
    severity: 'block',
    patterns: {
      es: [/\b(?:ingesta de oxigeno|oxigenacion|mejora(?:r|s)? (?:la )?circulacion|desintoxic\w+|detox|elimina(?:r)? (?:las )?toxinas|biorretroalimentacion)\b/],
      en: [/\b(?:oxygen intake|boosts? oxygen|improves? circulation|detox\w*|flush(?:es)? toxins|biofeedback)\b/],
    },
    detail: {
      es: 'Claims fisiológicos (oxígeno, circulación, toxinas, biorretroalimentación) necesitan prueba verificada: no los uses como beneficio.',
      en: 'Physiological claims (oxygen, circulation, toxins, biofeedback) need verified proof: do not use them as a benefit.',
    },
  },
  {
    id: 'appetite_metabolism_claim',
    categories: ['health_wellness', 'fitness_sports', 'beauty'],
    severity: 'block',
    patterns: {
      es: [/\b(?:control(?:ar|a)?\s+(?:del?\s+)?(?:el\s+)?(?:apetito|antojos)|reduc\w+\s+(?:de\s+)?(?:los\s+)?antojos|suprim\w+\s+(?:el\s+)?apetito|quema(?:r|s)?\s+(?:la\s+)?grasa|acelera(?:r|s)?\s+(?:el\s+)?metabolismo|saciedad prolongada)\b/],
      en: [/\b(?:appetite control|control (?:your )?cravings|reduces? cravings|suppress\w* appetite|burns? fat|speeds? up (?:your )?metabolism)\b/],
    },
    detail: {
      es: 'Claims de apetito, antojos, metabolismo o quema de grasa son claims de peso/salud: no se permiten.',
      en: 'Appetite, cravings, metabolism or fat-burning claims are weight/health claims: not allowed.',
    },
  },
  {
    id: 'anti_aging_mood_claim',
    categories: ['health_wellness', 'fitness_sports', 'beauty'],
    severity: 'warn',
    patterns: {
      es: [/\b(?:anti-?envejecimiento|rejuvenec\w+|bajones emocionales|equilibr\w+ (?:el )?estado emocional|paz mental)\b/],
      en: [/\b(?:anti-?aging|rejuvenat\w+|emotional crashes)\b/],
    },
    detail: {
      es: 'Anti-edad / estado emocional: claims de salud sin respaldo. Revisalo antes de usarlo.',
      en: 'Anti-aging / emotional-state claims are unbacked health claims. Review before use.',
    },
  },
  // --- Health / medical (all categories: any product can overclaim) -------
  {
    id: 'health_disease_claim',
    categories: 'all',
    severity: 'block',
    patterns: {
      es: [
        new RegExp(`\\b(?:cura|curan|curar|sana|sanar|elimina|eliminar|trata|tratar|combate|combatir|previene|prevenir|revierte|revertir|calma|calmar|calmas|alivia|aliviar|alivias|quita|quitar)\\s+(?:(?:el|la|los|las|tu|su)\\s+)?${DISEASES_ES}`),
        /\bcura (?:definitiva|natural|milagrosa)\b/,
      ],
      en: [
        new RegExp(`\\b(?:cures?|heals?|treats?|prevents?|reverses?|eliminates?|fights?|calms?|relieves?)\\s+(?:(?:the|your)\\s+)?${DISEASES_EN}`),
        /\b(?:miracle|natural) cure\b/,
      ],
    },
    detail: {
      es: 'No se permiten claims de curar, tratar o prevenir enfermedades.',
      en: 'Claims to cure, treat or prevent diseases are not allowed.',
    },
  },
  {
    id: 'health_personal_attribute',
    categories: 'all',
    severity: 'block',
    patterns: {
      es: [new RegExp(`(?:tenes|tienes|tiene|sufres|sufris|sufre|padeces|padeces|padece)\\s+(?:de\\s+)?(?:sobrepeso|${DISEASES_ES})`)],
      en: [new RegExp(`\\b(?:are you|you're|you are)\\s+(?:overweight|fat|obese|depressed)\\b|\\bdo you (?:have|suffer from)\\s+${DISEASES_EN}`)],
    },
    detail: {
      es: 'No asumas condiciones de salud del lector ("¿Tenés sobrepeso?").',
      en: 'Do not assert the reader\'s health condition ("Are you overweight?").',
    },
  },
  {
    id: 'weight_loss_promise',
    categories: 'all',
    severity: 'block',
    patterns: {
      es: [
        /\b(?:baja|bajar|bajas|bajes|pierde|perder|perdes|pierdas|reduce|reducir)\s+(?:hasta\s+)?(?:\d+\s*)?(?:kilos?|kg|libras?|lbs?|tallas?|peso)\b/,
        /\b(?:quema|quemar|quemas|derrite|derretir)\s+(?:la\s+)?grasa\b/,
        /\belimina(?:r)?\s+(?:la\s+)?grasa\s+(?:corporal|abdominal|localizada|del abdomen|de la panza)\b/,
        /\b(?:adelgaza|adelgazar|adelgazante|quemagrasa|quema grasa|reductor de peso)\b/,
        /\bbajar de peso\b/,
      ],
      en: [
        /\b(?:lose|losing|drop|shed)\s+(?:up to\s+)?(?:\d+\s*)?(?:pounds?|lbs?|kilos?|kg|sizes?|weight)\b/,
        /\b(?:burn|burns|melt|melts)\s+(?:belly\s+|body\s+)?fat\b/,
        /\b(?:fat burner|fat-burning|slimming|weight loss)\b/,
      ],
    },
    detail: {
      es: 'No se permiten promesas de pérdida de peso o quema de grasa.',
      en: 'Weight-loss or fat-burning promises are not allowed.',
    },
  },
  {
    id: 'drug_glp1_reference',
    categories: 'all',
    severity: 'block',
    patterns: {
      es: [/\b(?:glp-?1|ozempic|semaglutid[ae]|wegovy|mounjaro|tirzepatid[ae]|saxenda|liraglutid[ae])\b/, /\b(?:como|igual que|alternativa (?:a|al)) (?:un )?(?:medicamento|farmaco)\b/],
      en: [/\b(?:glp-?1|ozempic|semaglutide|wegovy|mounjaro|tirzepatide|saxenda|liraglutide)\b/, /\b(?:like|alternative to) (?:a )?(?:prescription|drug|medication)\b/],
    },
    detail: {
      es: 'No se permiten referencias a GLP-1 ni a medicamentos de prescripción.',
      en: 'References to GLP-1 or prescription drugs are not allowed.',
    },
  },
  {
    id: 'fake_expert_endorsement',
    categories: ['health_wellness', 'beauty', 'kids_baby', 'pets', 'fitness_sports', 'food_beverage'],
    severity: 'block',
    patterns: {
      es: [
        /\b(?:recomendado|recomendada|aprobado|aprobada|avalado|avalada|respaldado|respaldada)s? por (?:medicos|doctores|dermatologos|nutricionistas|pediatras|veterinarios|expertos|especialistas)\b/,
        /\b(?:medicos|doctores|dermatologos|nutricionistas|pediatras|veterinarios|expertos) (?:lo )?(?:recomiendan|aprueban|avalan)\b/,
      ],
      en: [
        /\b(?:doctor|dermatologist|nutritionist|pediatrician|vet|expert)s?[- ](?:recommended|approved|endorsed)\b/,
        /\b(?:recommended|approved|endorsed) by (?:doctors|dermatologists|nutritionists|pediatricians|vets|experts)\b/,
        /\b(?:doctors|dermatologists|experts) (?:recommend|approve)\b/,
      ],
    },
    detail: {
      es: 'No se permiten avales de médicos/expertos salvo certificación confirmada.',
      en: 'Doctor/expert endorsements are not allowed unless a certification is confirmed.',
    },
    exemptIfFactKeys: ['certification'],
  },
  {
    id: 'health_before_after',
    categories: ['health_wellness', 'fitness_sports'],
    severity: 'block',
    patterns: {
      es: [/\bantes y (?:el )?despues\b/, /\btransformacion (?:corporal|fisica|de tu cuerpo)\b/],
      en: [/\bbefore (?:and|&) after\b/, /\bbody transformation\b/],
    },
    detail: {
      es: 'Prohibido "antes/después" corporal en salud y fitness.',
      en: 'Body "before/after" is not allowed in health and fitness.',
    },
  },
  {
    id: 'health_absolute_safety',
    categories: ['health_wellness', 'beauty', 'kids_baby', 'pets', 'fitness_sports'],
    severity: 'block',
    patterns: {
      es: [/\bsin (?:ningun )?efectos? secundarios?\b/, /\b100\s*% (?:seguro|natural y seguro|efectivo)\b/, /\bmilagros[oa]s?\b/],
      en: [/\bno side effects\b/, /\b100\s*% (?:safe|effective)\b/, /\bmiracle\b/],
    },
    detail: {
      es: 'No se permiten afirmaciones absolutas de seguridad/eficacia ("sin efectos secundarios", "milagroso").',
      en: 'No absolute safety/efficacy claims ("no side effects", "miracle").',
    },
  },
  // --- Beauty -------------------------------------------------------------
  {
    id: 'beauty_guaranteed_results',
    categories: ['beauty', 'health_wellness', 'fitness_sports', 'education'],
    severity: 'block',
    patterns: {
      es: [/\bresultados? garantizados?\b/, /\bgarantizad[oa]s? (?:resultados?|que)\b/, /\b(?:para siempre|permanentemente|de por vida)\b/, /\ben (?:solo )?\d+ (?:dias|horas|semanas)\b.*\b(?:garantizado|seguro)\b/],
      en: [/\bguaranteed results?\b/, /\bresults? guaranteed\b/, /\b(?:forever|permanently)\b/],
    },
    detail: {
      es: 'No se garantizan resultados ni efectos permanentes.',
      en: 'Results and permanent effects cannot be guaranteed.',
    },
  },
  // --- Finance ------------------------------------------------------------
  {
    id: 'finance_guaranteed_returns',
    categories: ['finance', 'education', 'other', 'services_local'],
    severity: 'block',
    patterns: {
      es: [
        /\b(?:rendimientos?|ganancias?|retornos?|intereses?|ingresos?) (?:garantizad[oa]s?|asegurad[oa]s?|fij[oa]s? garantizad[oa]s?)\b/,
        /\b(?:sin riesgo|cero riesgo|riesgo cero)\b/,
        /\b(?:duplica|duplicar|triplica|multiplica) tu (?:dinero|inversion|plata)\b/,
        /\b(?:hacete|hazte|volverte|hacerte) (?:rico|millonario)\b/,
        /\bganas? \$?\d+[\d.,]* (?:al|por) (?:mes|dia|semana)\b/,
      ],
      en: [
        /\bguaranteed (?:returns?|income|profits?|gains?)\b/,
        /\b(?:risk-free|no risk|zero risk)\b/,
        /\b(?:double|triple|multiply) your (?:money|investment)\b/,
        /\bget rich\b/,
        /\bearn \$?\d+[\d.,]* (?:a|per) (?:month|day|week)\b/,
      ],
    },
    detail: {
      es: 'No se permiten rendimientos garantizados, "sin riesgo" ni promesas de ingresos.',
      en: 'Guaranteed returns, "risk-free" or income promises are not allowed.',
    },
  },
  // --- Generic (all) ------------------------------------------------------
  {
    id: 'fake_scarcity',
    categories: 'all',
    severity: 'block',
    patterns: {
      es: [
        /\b(?:solo|unicamente) (?:quedan|hay|tenemos) \d+\b/,
        /\b(?:ultimas?|quedan) \d+ (?:unidades|cupos|piezas|disponibles|espacios|lugares)\b/,
        /\b\d+ (?:personas|clientes) (?:lo )?(?:estan viendo|compraron hoy|compraron en la ultima hora)\b/,
      ],
      en: [/\bonly \d+ (?:left|remaining)\b/, /\blast \d+ (?:units|spots|pieces)\b/, /\b\d+ people (?:are viewing|bought today)\b/],
    },
    detail: {
      es: 'No se permite escasez numérica inventada.',
      en: 'Fabricated numeric scarcity is not allowed.',
    },
    exemptIfFactKeys: ['quantity_per_pack', 'proof_number'],
  },
  {
    id: 'vague_scarcity',
    categories: 'all',
    severity: 'warn',
    patterns: {
      es: [/\bultimas unidades\b/, /\bse agota(?:n)? hoy\b/],
      en: [/\blast units\b/, /\bselling out today\b/],
    },
    detail: {
      es: 'Escasez sin respaldo: usala solo si es real.',
      en: 'Unbacked scarcity: only use it if it is real.',
    },
  },
  {
    id: 'fabricated_statistic',
    categories: 'all',
    severity: 'block',
    patterns: {
      es: [
        /\b\d+ de cada \d+\b/,
        /\b\d+(?:[.,]\d+)?\s*% de (?:(?:nuestr[oa]s|l[oa]s) )?(?:clientes|usuarios|personas|mujeres|hombres|madres|padres|pacientes)\b/,
        /\b(?:miles|cientos|millones) de (?:clientes|personas|usuarios) (?:satisfech[oa]s|felices|ya lo usan)\b/,
        /(?:^|\s)(?:\+|mas de )\d+[\d.,]*\s*(?:mil\s+)?(?:clientes|ventas|pedidos|usuarios|resenas|vendid[oa]s|unidades vendidas|casas|familias)\b/,
        /\b(?:el|la) (?:numero|#) ?1\b/,
        /\b(?:el|la) mas vendid[oa] del (?:pais|mundo|mercado)\b/,
      ],
      en: [
        /\b\d+ (?:out of|in) \d+ (?:customers|people|users|women|men|moms|dentists|doctors)\b/,
        /\b\d+(?:[.,]\d+)?\s*% of (?:our )?(?:customers|users|people|women|men|moms|patients)\b/,
        /\b(?:thousands|hundreds|millions) of (?:happy|satisfied) (?:customers|users)\b/,
        /(?:^|\s)(?:\+|over |more than )\d+[\d.,]*k?\s*(?:customers|sales|orders|users|reviews|sold|units sold|families)\b/,
        /(?:^|\s)#\s?1\b|\bnumber one\b/,
        /\bbest[- ]selling in the (?:country|world)\b/,
      ],
    },
    detail: {
      es: 'Estadísticas o prueba social numérica solo si están confirmadas.',
      en: 'Statistics or numeric social proof only when confirmed.',
    },
    exemptIfFactKeys: ['proof_number', 'proof_review'],
  },
  {
    id: 'fabricated_review',
    categories: 'all',
    severity: 'block',
    patterns: {
      es: [/★{4,}|⭐{4,}/, /\b\d(?:[.,]\d)? ?estrellas\b/, /\bmiles de resenas\b/],
      en: [/★{4,}|⭐{4,}/, /\b\d(?:[.,]\d)?[- ]?stars?\b/, /\bthousands of reviews\b/],
    },
    detail: {
      es: 'Reseñas/estrellas solo si están confirmadas.',
      en: 'Reviews/stars only when confirmed.',
    },
    exemptIfFactKeys: ['proof_review', 'proof_number'],
  },
]

/** Disclaimers required for some category/format pairs. */
const DISCLAIMERS: Partial<Record<BusinessCategory, Partial<Record<AdFormat, Record<AdLanguage, string>>>>> = {
  beauty: {
    before_after: { es: 'Resultados pueden variar.', en: 'Results may vary.' },
  },
  home_garden: {
    before_after: { es: 'Imagen ilustrativa.', en: 'Illustrative image.' },
  },
  services_local: {
    before_after: { es: 'Resultados pueden variar.', en: 'Results may vary.' },
  },
}

const DISCLAIMER_PATTERNS: Record<AdLanguage, RegExp> = {
  es: /\b(?:resultados? (?:pueden|puede) variar|los resultados varian|imagen (?:ilustrativa|de referencia)|resultados individuales)\b/,
  en: /\b(?:results? (?:may|can) vary|individual results|illustrative (?:image|purposes))\b/,
}

const DISALLOWED_FORMATS: Partial<Record<BusinessCategory, AdFormat[]>> = {
  health_wellness: ['before_after'],
  fitness_sports: ['before_after'],
  finance: ['before_after'],
  education: ['before_after'],
  kids_baby: ['before_after'],
  pets: ['before_after'],
}

export function getDisallowedFormats(category: BusinessCategory): AdFormat[] {
  return [...(DISALLOWED_FORMATS[category] ?? [])]
}

export function isFormatAllowed(category: BusinessCategory, format: AdFormat): boolean {
  return !getDisallowedFormats(category).includes(format)
}

/** Disclaimer the copy must carry for this category/format, if any. */
export function getRequiredDisclaimer(category: BusinessCategory, format: AdFormat, language: AdLanguage): string | undefined {
  return DISCLAIMERS[category]?.[format]?.[language]
}

export function hasDisclaimer(text: string, language: AdLanguage): boolean {
  return DISCLAIMER_PATTERNS[language].test(normalizeText(text)) || DISCLAIMER_PATTERNS[language === 'es' ? 'en' : 'es'].test(normalizeText(text))
}

function ruleApplies(rule: ComplianceRule, category: BusinessCategory): boolean {
  return rule.categories === 'all' || rule.categories.includes(category)
}

export function rulesForCategory(category: BusinessCategory): ComplianceRule[] {
  return COMPLIANCE_RULES.filter((r) => ruleApplies(r, category))
}

export interface CheckComplianceOptions {
  /** Merged facts; confirmed ones can exempt proof/statistic/certification rules. */
  facts?: DnaFact[]
  /** When set, also enforce the format's required disclaimer. */
  format?: AdFormat
}

/**
 * Deterministic compliance scan. Returns every hit (block + warn); callers that
 * gate shipping should filter `severity === 'block'`.
 */
export function checkCompliance(
  text: string,
  category: BusinessCategory,
  language: AdLanguage,
  options: CheckComplianceOptions = {}
): ComplianceIssue[] {
  const norm = normalizeText(text)
  const issues: ComplianceIssue[] = []
  const confirmed = (options.facts ?? []).filter((f) => f.confirmed)
  for (const rule of rulesForCategory(category)) {
    // Run both languages' patterns: mixed-language copy is common.
    const patterns = [...rule.patterns[language], ...rule.patterns[language === 'es' ? 'en' : 'es']]
    for (const re of patterns) {
      const m = norm.match(re)
      if (!m) continue
      if (rule.exemptIfFactKeys && isExempt(m[0], rule.exemptIfFactKeys, confirmed)) continue
      issues.push({ ruleId: rule.id, severity: rule.severity, match: m[0], detail: rule.detail[language] })
      break
    }
  }
  if (options.format) {
    const disclaimer = getRequiredDisclaimer(category, options.format, language)
    if (disclaimer && !hasDisclaimer(text, language)) {
      issues.push({
        ruleId: 'missing_disclaimer',
        severity: 'block',
        match: '',
        detail: language === 'es' ? `Falta el disclaimer: "${disclaimer}"` : `Missing disclaimer: "${disclaimer}"`,
      })
    }
    if (!isFormatAllowed(category, options.format)) {
      issues.push({
        ruleId: 'format_not_allowed',
        severity: 'block',
        match: options.format,
        detail: language === 'es' ? `Formato ${options.format} no permitido en ${category}.` : `Format ${options.format} is not allowed for ${category}.`,
      })
    }
  }
  return issues
}

/** Fact keys that are claims about the product (not logistics/price): quarantined when banned. */
const CLAIM_FACT_KEYS: ReadonlySet<string> = new Set(['result_claim', 'how_it_works', 'differentiator', 'custom:allowed_claim', 'custom:verified_claim', 'custom:technical_specs', 'social_proof', 'guarantee'])

export interface BannedFact {
  key: string
  value: string
  ruleId: string
  match: string
}

/**
 * Platform (round 1): an offer can carry banned health claims as CONFIRMED facts ("sin efectos
 * secundarios", "calmar la ansiedad"). Confirmed facts are the copy's allowlist, so those would be
 * handed to the writer as truths. Every claim-type fact that trips a BLOCK compliance rule for the
 * brand's category is quarantined: it stops being confirmed (never offered to the writer, and copy
 * that repeats it fails as unconfirmed + compliance). Pure; returns the new list and what was blocked.
 */
export function quarantineBannedFacts<T extends { key: string; value: string; confirmed: boolean }>(facts: T[], category: BusinessCategory, language: AdLanguage): { facts: T[]; banned: BannedFact[] } {
  const banned: BannedFact[] = []
  const out = facts.map((f) => {
    if (!f.confirmed || !CLAIM_FACT_KEYS.has(f.key)) return f
    const hit = checkCompliance(f.value, category, language).find((i) => i.severity === 'block')
    if (!hit) return f
    banned.push({ key: f.key, value: f.value, ruleId: hit.ruleId, match: hit.match })
    return { ...f, confirmed: false }
  })
  return { facts: out, banned }
}

function isExempt(match: string, keys: FactKey[], confirmed: DnaFact[]): boolean {
  const backing = confirmed.filter((f) => keys.includes(f.key))
  if (!backing.length) return false
  const nums = extractNumericClaims(match).map((c) => c.value)
  if (!nums.length) return true
  const allowed = numbersInFacts(backing)
  return nums.every((n) => allowed.has(n))
}

/** Short guidance lines for the copy prompt. */
export function complianceGuidance(category: BusinessCategory, language: AdLanguage): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const rule of rulesForCategory(category)) {
    if (rule.severity !== 'block') continue
    const line = rule.detail[language]
    if (!seen.has(line)) {
      seen.add(line)
      out.push(line)
    }
  }
  return out
}
