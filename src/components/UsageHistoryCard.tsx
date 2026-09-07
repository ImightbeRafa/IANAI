import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { supabase } from '../lib/supabase'

type UsageKind = 'guion' | 'post' | 'image' | 'pack'

interface UsageHistoryItem {
  id: string
  at: string
  kind: UsageKind
  credits: number
  success: boolean
}

const MY_USAGE_URL = import.meta.env.PROD ? '/api/my-usage' : 'http://localhost:3000/api/my-usage'

const KIND_LABEL: Record<UsageKind, { es: string; en: string }> = {
  guion: { es: 'Guion', en: 'Script' },
  post: { es: 'Post', en: 'Post' },
  image: { es: 'Imagen', en: 'Image' },
  pack: { es: 'Pack', en: 'Pack' },
}

function formatWhen(iso: string, language: 'es' | 'en'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(language === 'es' ? 'es-CR' : 'en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export default function UsageHistoryCard({ language }: { language: 'es' | 'en' }) {
  const [items, setItems] = useState<UsageHistoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          if (!cancelled) setItems([])
          return
        }
        const response = await fetch(MY_USAGE_URL, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!response.ok) {
          throw new Error(language === 'es' ? 'No se pudo cargar el historial' : 'Could not load history')
        }
        const data = await response.json() as { items?: UsageHistoryItem[] }
        if (!cancelled) {
          setItems(Array.isArray(data.items) ? data.items : [])
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error')
          setItems([])
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [language])

  return (
    <div className="p-4 bg-dark-50 rounded-xl">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-primary-500" />
        <h3 className="text-sm font-medium text-dark-700">
          {language === 'es' ? 'Historial de uso' : 'Usage history'}
        </h3>
      </div>
      {items === null ? (
        <p className="text-xs text-dark-400">
          {language === 'es' ? 'Cargando…' : 'Loading…'}
        </p>
      ) : error ? (
        <p className="text-xs text-dark-400">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-dark-400">
          {language === 'es'
            ? 'Todavía no hay generaciones en tu cuenta.'
            : 'No generations on this account yet.'}
        </p>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 text-xs text-dark-700 border-b border-dark-200/60 pb-2 last:border-0 last:pb-0"
            >
              <div>
                <div className="font-medium text-dark-800">{KIND_LABEL[item.kind][language]}</div>
                <div className="text-dark-400">{formatWhen(item.at, language)}</div>
              </div>
              <div className="text-right shrink-0">
                <div>{item.credits} {language === 'es' ? 'créditos' : 'credits'}</div>
                <div className={item.success ? 'text-emerald-600' : 'text-red-500'}>
                  {item.success
                    ? (language === 'es' ? 'Correcto' : 'Success')
                    : (language === 'es' ? 'Falló' : 'Failed')}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
