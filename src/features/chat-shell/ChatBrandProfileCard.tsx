import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Pencil,
} from 'lucide-react'
import type { ProductType, SalesChannel } from '../../types'
import type { SetupFacts } from './chatShellBrandSetupFlow'
import type { SiteFieldEvidence, SiteFieldOrigin } from './chatShellSetupUploads'
import {
  IconAdvanceMark,
  IconDoc,
  IconImage,
  IconOffer,
  IconRefs,
  IconVisual,
  IconVoice,
  IconWeb,
} from './ChatShellIcons'

interface ChatBrandProfileCardProps {
  language?: 'en' | 'es'
  facts: SetupFacts
  busy?: boolean
  confirmed?: boolean
  evidence?: Record<string, SiteFieldEvidence>
  pages?: Array<{ url: string; title: string; ok: boolean }>
  defaultExpanded?: boolean
  defaultEditing?: boolean
  showCreateActions?: boolean
  activeCreateAction?: 'scripts' | 'post' | 'product' | null
  onSave: (facts: SetupFacts, confirm?: boolean) => Promise<boolean>
  onUpload: (file: File, kind: 'logo' | 'reference') => void | Promise<void>
  onCreateScripts: () => void
  onCreatePost: () => void
  onCreateProductPhoto: () => void
  onCreateOther: () => void
}

const COPY = {
  es: {
    title: 'Lo que entiendo de tu marca',
    subtitle: 'Esto es el contexto real que usaré para guiones, posts e imágenes.',
    known: 'Ya lo tengo',
    missing: 'Falta afinar',
    sourceWeb: 'Web analizada',
    sourceText: 'Texto y archivos',
    sourceOffer: 'Datos de la oferta',
    business: 'Negocio',
    audience: 'Público',
    offer: 'Oferta y argumento',
    voice: 'Voz de marca',
    visual: 'Identidad visual',
    name: 'Nombre',
    type: 'Tipo',
    channels: 'Canales',
    location: 'Ubicación',
    idealCustomer: 'Cliente ideal',
    offerName: 'Oferta o producto',
    what: 'Qué es y qué ofrece',
    problem: 'Problema que resuelve',
    result: 'Resultado prometido',
    difference: 'Diferenciador',
    alternatives: 'Alternativas actuales',
    objection: 'Objeción principal',
    tone: 'Cómo debe sonar',
    toneWords: 'Palabras de tono',
    mustUse: 'Frases que sí usa',
    avoid: 'Reglas permanentes y frases que evita',
    visualDirection: 'Estilo visual y de fotografía',
    logo: 'Logo oficial',
    uploadLogo: 'Subir o reemplazar logo',
    references: 'Referencias visuales',
    uploadReference: 'Agregar referencia',
    palette: 'Colores',
    save: 'Guardar cambios',
    saved: 'Guardado',
    confirm: 'Confirmar y empezar a crear',
    nextPrompt: '¿Qué hacemos primero?',
    readyTitle: 'Brand Kit listo',
    readyCopy: 'Ya está conectado al contexto de creación. ¿Qué hacemos primero?',
    scripts: 'Crear guiones',
    post: 'Crear post',
    productPhoto: 'Foto de producto',
    other: 'Otra pieza',
    edit: 'Editar',
    review: 'Revisar',
    collapse: 'Ocultar',
    fromWeb: 'De la web',
    inferred: 'Inferido',
    confirmNeeded: 'Por confirmar',
    pagesRead: 'páginas leídas',
  },
  en: {
    title: 'What I understand about your brand',
    subtitle: 'This is the real context I’ll use for scripts, posts, and images.',
    known: 'Already known',
    missing: 'Needs tuning',
    sourceWeb: 'Website analyzed',
    sourceText: 'Text and files',
    sourceOffer: 'Offer data',
    business: 'Business',
    audience: 'Audience',
    offer: 'Offer and argument',
    voice: 'Brand voice',
    visual: 'Visual identity',
    name: 'Name',
    type: 'Type',
    channels: 'Channels',
    location: 'Location',
    idealCustomer: 'Ideal customer',
    offerName: 'Offer or product',
    what: 'What it is and offers',
    problem: 'Problem it solves',
    result: 'Promised outcome',
    difference: 'Differentiator',
    alternatives: 'Current alternatives',
    objection: 'Main objection',
    tone: 'How it should sound',
    toneWords: 'Tone keywords',
    mustUse: 'Phrases to use',
    avoid: 'Permanent rules and phrases to avoid',
    visualDirection: 'Visual and photo style',
    logo: 'Official logo',
    uploadLogo: 'Upload or replace logo',
    references: 'Visual references',
    uploadReference: 'Add reference',
    palette: 'Colors',
    save: 'Save changes',
    saved: 'Saved',
    confirm: 'Confirm and start creating',
    nextPrompt: 'What should we make first?',
    readyTitle: 'Brand Kit ready',
    readyCopy: 'It is now connected to creation context. What should we make first?',
    scripts: 'Create scripts',
    post: 'Create post',
    productPhoto: 'Product photo',
    other: 'Another asset',
    edit: 'Edit',
    review: 'Review',
    collapse: 'Collapse',
    fromWeb: 'From website',
    inferred: 'Inferred',
    confirmNeeded: 'Needs confirmation',
    pagesRead: 'pages read',
  },
} as const

const CHANNELS: SalesChannel[] = ['website', 'messages', 'physical']
const TYPES: ProductType[] = ['product', 'service', 'restaurant', 'real_estate', 'indumentaria']

function listText(items: string[]): string {
  return items.join(', ')
}

function parseList(value: string): string[] {
  return value.split(/[,\n|]/).map((item) => item.trim()).filter(Boolean)
}

export default function ChatBrandProfileCard({
  language = 'es',
  facts,
  busy = false,
  confirmed = false,
  evidence = {},
  pages = [],
  defaultExpanded = false,
  defaultEditing = false,
  showCreateActions = true,
  activeCreateAction = null,
  onSave,
  onUpload,
  onCreateScripts,
  onCreatePost,
  onCreateProductPhoto,
}: ChatBrandProfileCardProps) {
  const t = COPY[language]
  const [local, setLocal] = useState(facts)
  const [expanded, setExpanded] = useState(defaultExpanded || defaultEditing)
  const [editing, setEditing] = useState(defaultEditing)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const logoRef = useRef<HTMLInputElement>(null)
  const referenceRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!dirty) setLocal(facts)
  }, [facts, dirty])

  const missing = useMemo<string[]>(() => [
    !local.businessName ? t.business : null,
    local.salesChannels.length === 0 ? t.channels : null,
    !local.offerName || !local.product_description ? t.offer : null,
    !local.icp ? t.audience : null,
    !local.brand_voice ? t.voice : null,
    !local.logo_url && !local.brand_visual && !local.primary_color ? t.visual : null,
  ].filter(Boolean) as string[], [local, t])
  const completed = 6 - missing.length
  const evidenceCounts = useMemo(() => ({
    web: Object.values(evidence).filter((item) => item.origin === 'web').length,
    inferred: Object.values(evidence).filter((item) => item.origin === 'inferred').length,
    missing: Object.values(evidence).filter((item) => item.origin === 'missing').length,
  }), [evidence])

  const sectionOrigin = (keys: string[]): SiteFieldOrigin | null => {
    const origins = keys.map((key) => evidence[key]?.origin).filter(Boolean)
    if (origins.includes('web')) return 'web'
    if (origins.includes('inferred')) return 'inferred'
    if (origins.includes('missing')) return 'missing'
    return null
  }

  const originLabel = (origin: SiteFieldOrigin | null) => {
    if (origin === 'web') return t.fromWeb
    if (origin === 'inferred') return t.inferred
    if (origin === 'missing') return t.confirmNeeded
    return null
  }

  const patch = <K extends keyof SetupFacts>(key: K, value: SetupFacts[K]) => {
    setSaved(false)
    setDirty(true)
    setLocal((prev) => ({ ...prev, [key]: value }))
  }

  const toggleChannel = (channel: SalesChannel) => {
    patch(
      'salesChannels',
      local.salesChannels.includes(channel)
        ? local.salesChannels.filter((item) => item !== channel)
        : [...local.salesChannels, channel]
    )
  }

  const removeRule = (rule: string) => {
    patch('forbidden_phrases', local.forbidden_phrases.filter((item) => item !== rule))
  }

  const removeReference = (url: string) => {
    patch('reference_images', local.reference_images.filter((item) => item !== url))
  }

  const save = async (confirm = false) => {
    const ok = await onSave(local, confirm)
    if (ok) {
      setSaved(true)
      setDirty(false)
      setEditing(false)
      setExpanded(false)
    }
    return ok
  }

  const startCreate = async (run: () => void) => {
    if (!confirmed) {
      const ok = await save(true)
      if (!ok) return
    }
    run()
  }

  return (
    <section className={`chat-shell__brand-profile${confirmed ? ' is-confirmed' : ''}`} aria-label={t.title}>
      <div className="chat-shell__brand-profile-head">
        <div className="chat-shell__brand-profile-mark"><IconAdvanceMark size={28} /></div>
        <div>
          <strong>{confirmed ? t.readyTitle : t.title}</strong>
          <p>{confirmed ? t.readyCopy : t.subtitle}</p>
        </div>
        {!expanded ? (
          <button type="button" className="chat-shell__brand-profile-edit" disabled={busy} onClick={() => setExpanded(true)} aria-expanded={false}>
            <ChevronDown size={13} /> {t.review}
          </button>
        ) : !editing ? (
          <button type="button" className="chat-shell__brand-profile-edit" disabled={busy} onClick={() => setEditing(true)}>
            <Pencil size={13} /> {t.edit}
          </button>
        ) : (
          <button
            type="button"
            className="chat-shell__brand-profile-edit"
            disabled={busy}
            onClick={() => {
              setLocal(facts)
              setDirty(false)
              setEditing(false)
              setExpanded(false)
            }}
          >
            <ChevronDown size={13} /> {t.collapse}
          </button>
        )}
      </div>

      {!expanded ? (
        <div className="chat-shell__brand-profile-compact">
          {local.logo_url ? (
            <img className="chat-shell__brand-profile-compact-logo" src={local.logo_url} alt={t.logo} />
          ) : (
            <span className="chat-shell__brand-profile-compact-logo is-empty" aria-hidden="true"><IconImage size={14} /></span>
          )}
          <span className="chat-shell__brand-profile-compact-progress">{completed}/6</span>
          <strong>{local.offerName || local.businessName || t.missing}</strong>
          <span>{missing.length ? `${t.missing}: ${missing.slice(0, 3).join(', ')}` : t.known}</span>
          <div className="chat-shell__brand-profile-compact-colors" aria-label={t.palette}>
            {[local.primary_color, local.secondary_color, local.accent_color].filter(Boolean).map((color) => (
              <i key={color} style={{ background: color }} title={color} />
            ))}
          </div>
        </div>
      ) : null}

      {!confirmed && expanded ? (
        <>
          <div className="chat-shell__brand-profile-meter" aria-label={`${completed}/6`}>
            <span style={{ width: `${Math.max(8, (completed / 6) * 100)}%` }} />
          </div>
          <div className="chat-shell__brand-profile-sources">
            {local.sourceUrl ? <span><IconWeb size={12} />{t.sourceWeb}</span> : null}
            {local.sourceText ? <span><IconDoc size={12} />{t.sourceText}</span> : null}
            {local.offerName ? <span><IconOffer size={12} />{t.sourceOffer}</span> : null}
            {pages.filter((page) => page.ok).length ? <span><IconWeb size={12} />{pages.filter((page) => page.ok).length} {t.pagesRead}</span> : null}
          </div>
          {Object.keys(evidence).length ? (
            <div className="chat-shell__brand-profile-origin-summary">
              <span className="is-web">{evidenceCounts.web} {t.fromWeb}</span>
              <span className="is-inferred">{evidenceCounts.inferred} {t.inferred}</span>
              <span className="is-missing">{evidenceCounts.missing} {t.confirmNeeded}</span>
            </div>
          ) : null}
          <div className="chat-shell__brand-profile-glance">
            <button type="button" onClick={() => setEditing(true)}>
              <span>{t.business}{sectionOrigin(['businessName', 'salesChannels', 'location']) ? <em data-origin={sectionOrigin(['businessName', 'salesChannels', 'location']) || undefined}>{originLabel(sectionOrigin(['businessName', 'salesChannels', 'location']))}</em> : null}</span>
              <strong>{local.businessName || t.missing}</strong>
              <small>{[local.storageType, ...local.salesChannels, local.location].filter(Boolean).join(' · ')}</small>
            </button>
            <button type="button" onClick={() => setEditing(true)}>
              <span>{t.offer}{sectionOrigin(['offerName', 'product_description', 'utility']) ? <em data-origin={sectionOrigin(['offerName', 'product_description', 'utility']) || undefined}>{originLabel(sectionOrigin(['offerName', 'product_description', 'utility']))}</em> : null}</span>
              <strong>{local.offerName || t.missing}</strong>
              <small>{local.product_description || local.utility || t.missing}</small>
            </button>
            <button type="button" onClick={() => setEditing(true)}>
              <span>{t.audience}{sectionOrigin(['icp', 'main_problem', 'expected_result']) ? <em data-origin={sectionOrigin(['icp', 'main_problem', 'expected_result']) || undefined}>{originLabel(sectionOrigin(['icp', 'main_problem', 'expected_result']))}</em> : null}</span>
              <strong>{local.icp || t.missing}</strong>
              <small>{[local.main_problem, local.expected_result || local.result].filter(Boolean).join(' → ')}</small>
            </button>
            <button type="button" onClick={() => setEditing(true)}>
              <span>{t.difference}{sectionOrigin(['differentiation', 'key_objection', 'current_alternatives']) ? <em data-origin={sectionOrigin(['differentiation', 'key_objection', 'current_alternatives']) || undefined}>{originLabel(sectionOrigin(['differentiation', 'key_objection', 'current_alternatives']))}</em> : null}</span>
              <strong>{local.differentiation || t.missing}</strong>
              <small>{local.key_objection ? `${t.objection}: ${local.key_objection}` : local.current_alternatives}</small>
            </button>
            <button type="button" onClick={() => setEditing(true)}>
              <span>{t.voice}{sectionOrigin(['brand_voice', 'tone_keywords', 'must_use_phrases']) ? <em data-origin={sectionOrigin(['brand_voice', 'tone_keywords', 'must_use_phrases']) || undefined}>{originLabel(sectionOrigin(['brand_voice', 'tone_keywords', 'must_use_phrases']))}</em> : null}</span>
              <strong>{local.brand_voice || t.missing}</strong>
              <small>{[...local.tone_keywords, ...local.must_use_phrases].slice(0, 4).join(' · ')}</small>
            </button>
            <button type="button" className="is-visual" onClick={() => setEditing(true)}>
              <span>{t.visual}{sectionOrigin(['brand_visual', 'primary_color', 'logo_url']) ? <em data-origin={sectionOrigin(['brand_visual', 'primary_color', 'logo_url']) || undefined}>{originLabel(sectionOrigin(['brand_visual', 'primary_color', 'logo_url']))}</em> : null}</span>
              <strong>{local.brand_visual || (local.logo_url ? t.logo : t.missing)}</strong>
              <small>{[local.primary_color, local.secondary_color, local.accent_color].filter(Boolean).join(' · ')}</small>
              {local.logo_url ? <img src={local.logo_url} alt="" /> : null}
            </button>
          </div>
          {missing.length ? (
            <div className="chat-shell__brand-profile-missing">
              <span>{t.missing}</span>
              {missing.map((item) => <button type="button" key={item} onClick={() => setEditing(true)}>{item}</button>)}
            </div>
          ) : (
            <div className="chat-shell__brand-profile-known"><Check size={13} /> {t.known}</div>
          )}
        </>
      ) : null}

      {editing && expanded ? (
        <div className="chat-shell__brand-profile-editor">
          <details open>
            <summary><IconOffer size={15} /><span>{t.business}</span><ChevronDown size={14} /></summary>
            <div className="chat-shell__brand-profile-fields two-col">
              <label>{t.name}<input value={local.businessName} onChange={(e) => patch('businessName', e.target.value)} /></label>
              <label>{t.type}<select value={local.storageType} onChange={(e) => patch('storageType', e.target.value as ProductType)}>{TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
              <div className="chat-shell__brand-profile-field full"><span>{t.channels}</span><div className="chat-shell__brand-profile-chips">{CHANNELS.map((channel) => <button type="button" key={channel} className={local.salesChannels.includes(channel) ? 'is-on' : ''} onClick={() => toggleChannel(channel)}>{channel}</button>)}</div></div>
              <label className="full">{t.location}<input value={local.location} onChange={(e) => patch('location', e.target.value)} /></label>
            </div>
          </details>

          <details open>
            <summary><IconOffer size={15} /><span>{t.offer}</span><ChevronDown size={14} /></summary>
            <div className="chat-shell__brand-profile-fields two-col">
              <label className="full">{t.offerName}<input value={local.offerName} onChange={(e) => patch('offerName', e.target.value)} /></label>
              <label className="full">{t.what}<textarea value={local.product_description} onChange={(e) => patch('product_description', e.target.value)} /></label>
              <label>{t.problem}<textarea value={local.main_problem} onChange={(e) => patch('main_problem', e.target.value)} /></label>
              <label>{t.result}<textarea value={local.expected_result || local.result} onChange={(e) => patch('expected_result', e.target.value)} /></label>
              <label>{t.difference}<textarea value={local.differentiation} onChange={(e) => patch('differentiation', e.target.value)} /></label>
              <label>{t.objection}<textarea value={local.key_objection} onChange={(e) => patch('key_objection', e.target.value)} /></label>
              <label className="full">{t.alternatives}<input value={local.current_alternatives} onChange={(e) => patch('current_alternatives', e.target.value)} /></label>
            </div>
          </details>

          <details open>
            <summary><IconVoice size={15} /><span>{t.audience} + {t.voice}</span><ChevronDown size={14} /></summary>
            <div className="chat-shell__brand-profile-fields two-col">
              <label className="full">{t.idealCustomer}<textarea value={local.icp} onChange={(e) => patch('icp', e.target.value)} /></label>
              <label className="full">{t.tone}<textarea value={local.brand_voice} onChange={(e) => patch('brand_voice', e.target.value)} /></label>
              <label>{t.toneWords}<input value={listText(local.tone_keywords)} onChange={(e) => patch('tone_keywords', parseList(e.target.value))} /></label>
              <label>{t.mustUse}<input value={listText(local.must_use_phrases)} onChange={(e) => patch('must_use_phrases', parseList(e.target.value))} /></label>
              <label className="full">{t.avoid}<input value={listText(local.forbidden_phrases)} onChange={(e) => patch('forbidden_phrases', parseList(e.target.value))} /></label>
              {local.forbidden_phrases.length ? (
                <div className="chat-shell__brand-rules full">
                  {local.forbidden_phrases.map((rule) => (
                    <button key={rule} type="button" title={language === 'es' ? 'Quitar regla' : 'Remove rule'} onClick={() => removeRule(rule)}>
                      <span>{rule}</span><span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </details>

          <details open>
            <summary><IconVisual size={15} /><span>{t.visual}</span><ChevronDown size={14} /></summary>
            <div className="chat-shell__brand-profile-visual">
              <div className="chat-shell__brand-profile-logo">
                {local.logo_url ? <img src={local.logo_url} alt={t.logo} /> : <div><IconImage size={20} /></div>}
                <button type="button" disabled={busy} onClick={() => logoRef.current?.click()}>{t.uploadLogo}</button>
                <input ref={logoRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onUpload(file, 'logo'); e.target.value = '' }} />
              </div>
              <div className="chat-shell__brand-profile-colors" aria-label={t.palette}>
                {(['primary_color', 'secondary_color', 'accent_color'] as const).map((key) => <label key={key}><input type="color" value={local[key] || '#71717a'} onChange={(e) => patch(key, e.target.value)} /><span>{local[key] || '—'}</span></label>)}
              </div>
              <label className="chat-shell__brand-profile-visual-notes">{t.visualDirection}<textarea value={local.brand_visual} onChange={(e) => patch('brand_visual', e.target.value)} /></label>
              <div className="chat-shell__brand-profile-refs">
                <span>{t.references}</span>
                <div>{local.reference_images.slice(0, 8).map((url) => <button className="chat-shell__brand-reference" type="button" key={url} title={language === 'es' ? 'Quitar referencia' : 'Remove reference'} onClick={() => removeReference(url)}><img src={url} alt="" /><span aria-hidden="true">×</span></button>)}<button type="button" disabled={busy} onClick={() => referenceRef.current?.click()}><IconRefs size={15} />{t.uploadReference}</button></div>
                <input ref={referenceRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onUpload(file, 'reference'); e.target.value = '' }} />
              </div>
            </div>
          </details>

          <div className="chat-shell__brand-profile-actions">
            <button type="button" className="chat-shell__btn" disabled={busy} onClick={() => void save(false)}>{saved ? t.saved : t.save}</button>
            <button type="button" className="chat-shell__btn chat-shell__btn--primary" disabled={busy} onClick={() => void save(true)}>{t.confirm}</button>
          </div>
        </div>
      ) : null}

      {!editing && showCreateActions ? (
        <div className="chat-shell__brand-profile-create">
          {!confirmed ? <p className="chat-shell__brand-profile-next">{t.nextPrompt}</p> : null}
          <button type="button" className={activeCreateAction === 'scripts' ? 'is-on' : undefined} aria-pressed={activeCreateAction === 'scripts'} onClick={() => void startCreate(onCreateScripts)}><IconDoc size={15} />{t.scripts}</button>
          <button type="button" className={activeCreateAction === 'post' ? 'is-on' : undefined} aria-pressed={activeCreateAction === 'post'} onClick={() => void startCreate(onCreatePost)}><IconImage size={15} />{t.post}</button>
          <button type="button" className={activeCreateAction === 'product' ? 'is-on' : undefined} aria-pressed={activeCreateAction === 'product'} onClick={() => void startCreate(onCreateProductPhoto)}><IconOffer size={15} />{t.productPhoto}</button>
        </div>
      ) : null}
    </section>
  )
}
