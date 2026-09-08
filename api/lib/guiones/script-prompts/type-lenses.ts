import type { CTAStrength, Language, ScriptFramework } from '../types.js'

export function getTypeLens(scriptType: ScriptFramework, ctaStrength: CTAStrength | undefined, language: Language): string {
  const isEs = language === 'es'
  const cta = ctaStrength || 'sales'
  const salesCta = isEs
    ? `CTA configurado: ${cta}. Si es sales, una instrucción directa. Si es soft/none/brand_mention, no uses presión de venta.`
    : `CTA configured: ${cta}. If sales, use one direct instruction. If soft/none/brand_mention, do not use sales pressure.`

  const lenses: Record<ScriptFramework, string> = {
    venta_directa: isEs
      ? `TIPO VENTA DIRECTA: elegí UN subtipo (oferta directa, precio/valor, comprador caliente, logística/riesgo, drop, prueba/hito o caso de uso) y escribí hablado, con tensión o deseo concreto — no "Comprá tu X de Marca". Diferenciador real, no slogan. Logística solo si aporta. Sin placeholders. Soná natural vendiendo en directo. ${salesCta}`
      : `DIRECT SALE TYPE: pick ONE subtype (direct offer, price/value, hot buyer, logistics/risk, drop, proof/milestone, or use case) and write spoken copy with concrete desire — not "Buy your X from Brand". Real differentiator, not slogan. Logistics only if it helps. No empty placeholders. Sound natural while selling directly. ${salesCta}`,
    desvalidar_alternativas: isEs
      ? `TIPO DESVALIDAR ALTERNATIVAS: no siempre significa atacar competidores. Ayudá al comprador a decidir mejor. Elegí un subtipo: hidden_cost, wrong_fit, checklist, myth_correction, old_way_vs_better_way, use_case_split o spec_process_contrast. Nunca inventes defectos de competidores. Si faltan datos, usá un checklist con hechos reales disponibles — sin corchetes.`
      : `INVALIDATE ALTERNATIVES TYPE: this does not always mean attacking competitors. Help the buyer make a smarter decision. Choose one subtype: hidden_cost, wrong_fit, checklist, myth_correction, old_way_vs_better_way, use_case_split, or spec_process_contrast. Never invent competitor flaws. If facts are missing, use a checklist with available real facts — no bracket placeholders.`,
    mostrar_servicio: isEs
      ? `TIPO MOSTRAR SERVICIO/PRODUCTO: mostrá principio a fin. El desarrollo debe dar pasos concretos, sensaciones, herramientas o pruebas visibles.`
      : `SHOW SERVICE/PRODUCT TYPE: show start to finish. Development must give concrete steps, sensations, tools, or visible proof.`,
    variedad_productos: isEs
      ? `TIPO VARIEDAD: ayudá a elegir. Dividí opciones por perfil, uso, momento, gusto, presupuesto o necesidad. Cada opción debe tener una diferencia real.`
      : `VARIETY TYPE: help the buyer choose. Split options by profile, use, moment, taste, budget, or need. Each option needs a real difference.`,
    paso_a_paso: isEs
      ? `TIPO PASO A PASO: explicá la compra, uso, agenda, proceso o entrega en pasos secos. Ideal para eliminar fricción logística.`
      : `STEP BY STEP TYPE: explain purchase, use, booking, process, or delivery in dry steps. Ideal for removing logistics friction.`,
    reconocimiento: isEs
      ? `TIPO RECONOCIMIENTO: micro-historia humana. Sin CTA comercial, sin beneficios enumerados. Una escena, una emoción, un detalle de marca como consecuencia.`
      : `AWARENESS TYPE: human micro-story. No commercial CTA, no benefit list. One scene, one emotion, one brand detail as consequence.`,
    educativo: isEs
      ? `TIPO EDUCATIVO ORGÁNICO: enseñá algo útil. Usá errores, checklist, mito, tip o mini-framework. Debe valer aunque el espectador no compre.`
      : `ORGANIC EDUCATIONAL TYPE: teach something useful. Use mistake, checklist, myth, tip, or mini-framework. It must be valuable even if the viewer never buys.`,
    storytelling: isEs
      ? `TIPO STORYTELLING ORGÁNICO: una historia real o verosímil con conflicto, giro e insight. La marca aparece natural, no como protagonista comercial.`
      : `ORGANIC STORYTELLING TYPE: a real or plausible story with conflict, turn, and insight. The brand appears naturally, not as commercial protagonist.`,
    tendencia: isEs
      ? `TIPO TENDENCIA ORGÁNICA: usá formato social reconocible solo si encaja con el nicho. Rápido, visual, específico y con remate. No fuerces trends.`
      : `ORGANIC TREND TYPE: use a recognizable social format only if it fits the niche. Fast, visual, specific, with a punchline. Do not force trends.`,
    engagement: isEs
      ? `TIPO ENGAGEMENT ORGÁNICO: provocá respuesta real con dilema, pregunta o this-or-that con valor. Prohibido comment bait vacío.`
      : `ORGANIC ENGAGEMENT TYPE: provoke real response with a dilemma, question, or valuable this-or-that. No empty comment bait.`,
  }
  return lenses[scriptType]
}
