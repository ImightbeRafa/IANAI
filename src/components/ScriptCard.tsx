import { useState } from 'react'
import { Copy, Check, BookmarkPlus, Loader2 } from 'lucide-react'
import type { ParsedScript } from '../utils/scriptParser'

interface ScriptCardProps {
  script: ParsedScript
  language: 'en' | 'es'
  onSave?: (content: string, title: string) => Promise<string | null>
  isSaved?: boolean
  savingScript?: boolean
}

export default function ScriptCard({ script, language, onSave, isSaved, savingScript }: ScriptCardProps) {
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(isSaved || false)

  const handleCopy = () => {
    navigator.clipboard.writeText(script.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSave = async () => {
    if (!onSave || saved || saving) return
    setSaving(true)
    try {
      const id = await onSave(script.content, script.title)
      if (id) setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-dark-100 rounded-xl overflow-hidden transition-shadow hover:shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-dark-50 bg-dark-50/40">
        <span className="text-xs font-semibold text-dark-600 tracking-wide">
          {script.title}
        </span>
        <span className="text-[10px] text-dark-300 font-mono">
          #{script.index}
        </span>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        <div className="text-sm text-dark-700 leading-relaxed whitespace-pre-wrap">
          {script.content}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-dark-50">
        <button
          onClick={handleCopy}
          className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors ${
            copied
              ? 'bg-green-50 text-green-600'
              : 'text-dark-400 hover:bg-dark-50 hover:text-dark-700'
          }`}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied
            ? (language === 'es' ? 'Copiado' : 'Copied')
            : (language === 'es' ? 'Copiar' : 'Copy')
          }
        </button>

        {onSave && (
          <button
            onClick={handleSave}
            disabled={saved || saving || savingScript}
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors ${
              saved
                ? 'bg-green-50 text-green-600'
                : 'text-dark-400 hover:bg-primary-50 hover:text-primary-600'
            }`}
          >
            {saving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <BookmarkPlus className="w-3 h-3" />
            )}
            {saved
              ? (language === 'es' ? 'Guardado' : 'Saved')
              : (language === 'es' ? 'Guardar' : 'Save')
            }
          </button>
        )}
      </div>
    </div>
  )
}
