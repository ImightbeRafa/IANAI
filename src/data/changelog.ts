export type ChangeCategory = 'feature' | 'fix' | 'improvement' | 'rework'
export type RoadmapStatus = 'planned' | 'in_progress' | 'beta' | 'done'

export interface ChangelogEntry {
  version: string
  date: string // YYYY-MM-DD
  items: {
    category: ChangeCategory
    text: { es: string; en: string }
  }[]
}

export interface RoadmapItem {
  status: RoadmapStatus
  text: { es: string; en: string }
  eta?: string
}

export interface StatusAlert {
  active: boolean
  text: { es: string; en: string }
  severity: 'info' | 'warning' | 'error'
}

// =============================================
// STATUS ALERT — show if a feature is having issues
// Set active: false to hide
// =============================================
export const STATUS_ALERT: StatusAlert = {
  active: false,
  text: {
    es: 'La generación de imágenes puede tardar más de lo normal. Estamos trabajando en ello.',
    en: 'Image generation may be slower than usual. We are working on it.'
  },
  severity: 'info'
}

// =============================================
// ROADMAP — what's coming next
// =============================================
export const ROADMAP: RoadmapItem[] = [
  {
    status: 'in_progress',
    text: {
      es: 'Brand Kit — identidad visual y tonal aplicada automáticamente',
      en: 'Brand Kit — auto-applied visual and tonal identity'
    },
    eta: 'Feb 2026'
  },
  {
    status: 'planned',
    text: {
      es: 'Analíticas de rendimiento — métricas de tus guiones y posts',
      en: 'Performance analytics — metrics for your scripts and posts'
    }
  },
  {
    status: 'planned',
    text: {
      es: 'Plantillas de guiones — guarda y reutiliza estructuras que funcionan',
      en: 'Script templates — save and reuse structures that work'
    }
  }
]

// =============================================
// CHANGELOG — add new entries at the TOP
// =============================================
//
// EDITORIAL GUIDELINES (for developers / AI assistants):
// 1. NEVER include admin-only changes (admin dashboard, admin routes, internal tooling).
// 2. NEVER expose security fixes in detail — omit them entirely or use vague
//    user-facing language like "Mejoras generales de estabilidad" / "General stability improvements".
// 3. Only list changes that are visible or meaningful to end users.
// 4. Keep language simple, non-technical, and benefit-oriented.
// 5. Do NOT mention internal architecture, database migrations, or RLS policies.
//
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.5.0',
    date: '2026-02-24',
    items: [
      {
        category: 'feature',
        text: {
          es: 'Brand Kit — define colores, voz y frases de tu marca en Configuración',
          en: 'Brand Kit — define brand colors, voice and phrases in Settings'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Sección "Desde el Desarrollador" — changelog, roadmap y feedback',
          en: '"From the Developer" section — changelog, roadmap and feedback'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Instrucciones adicionales al generar posts — guía el estilo y diseño con texto libre',
          en: 'Additional instructions when generating posts — guide style and design with free text'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Los ratings de guiones ahora se guardan y persisten entre sesiones',
          en: 'Script ratings now persist across sessions'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Ratings positivos ahora también mejoran la memoria de IA',
          en: 'Positive ratings now also improve AI memory'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Ahora puedes ver el uso de respuestas en tu resumen del plan',
          en: 'Reply usage now visible in your plan summary'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Mejoras generales de estabilidad y rendimiento',
          en: 'General stability and performance improvements'
        }
      }
    ]
  },
  {
    version: '2.4.0',
    date: '2026-02-23',
    items: [
      {
        category: 'feature',
        text: {
          es: 'Estilos de post personalizados — sube referencias y crea tu propio estilo',
          en: 'Custom post styles — upload references and create your own style'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Respuestas a clientes (Respuestas) — genera respuestas de venta con IA',
          en: 'Client replies (Respuestas) — generate AI-powered sales replies'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Varita mágica — mejora posts generados con un click',
          en: 'Magic wand — enhance generated posts with one click'
        }
      }
    ]
  },
  {
    version: '2.3.0',
    date: '2026-02-16',
    items: [
      {
        category: 'feature',
        text: {
          es: '8 presets de estilo para posts (Features, Showcase, Social Proof, etc.)',
          en: '8 post style presets (Features, Showcase, Social Proof, etc.)'
        }
      },
      {
        category: 'feature',
        text: {
          es: 'Paletas de colores predefinidas y personalizadas para posts',
          en: 'Predefined and custom color palettes for posts'
        }
      },
      {
        category: 'improvement',
        text: {
          es: 'Edición de imágenes con IA — modifica posts generados con instrucciones',
          en: 'AI image editing — modify generated posts with instructions'
        }
      }
    ]
  }
]
