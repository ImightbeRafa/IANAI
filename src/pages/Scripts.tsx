import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getScripts, deleteScript } from '../services/database'
import type { Script } from '../types'
import Layout from '../components/Layout'
import { FileText, Trash2, Download, Copy, Check } from 'lucide-react'

const ANGLE_LABELS: Record<string, string> = {
  direct_sale: 'Direct Sale',
  discredit_competitors: 'Discredit Competitors',
  process_certainty: 'Process Certainty',
  pain_solution: 'Pain/Solution',
  social_proof: 'Social Proof'
}

export default function Scripts() {
  const { user } = useAuth()
  const [scripts, setScripts] = useState<Script[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    loadScripts()
  }, [user])

  const loadScripts = async () => {
    if (!user) return
    setLoading(true)
    try {
      const data = await getScripts(user.id)
      setScripts(data)
    } catch (error) {
      console.error('Failed to load scripts:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this script?')) return
    try {
      await deleteScript(id)
      setScripts(prev => prev.filter(s => s.id !== id))
    } catch (error) {
      console.error('Failed to delete script:', error)
    }
  }

  const handleCopy = async (script: Script) => {
    await navigator.clipboard.writeText(script.content)
    setCopiedId(script.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleExport = (script: Script) => {
    const text = `${script.title}\n\nAngle: ${ANGLE_LABELS[script.angle] || script.angle}\n\n${script.content}`
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${script.title.replace(/\s+/g, '-').toLowerCase()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-dark-900">My Scripts</h1>
          <p className="text-dark-500 mt-1">All your generated ad scripts</p>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-40 bg-dark-100 rounded"></div>
              </div>
            ))}
          </div>
        ) : scripts.length === 0 ? (
          <div className="card text-center py-12">
            <FileText className="w-12 h-12 text-dark-300 mx-auto mb-4" />
            <p className="text-dark-500">No scripts saved yet</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {scripts.map((script) => (
              <div key={script.id} className="card">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-medium text-dark-900">{script.title}</h3>
                    <span className="text-xs px-2 py-0.5 bg-primary-100 text-primary-700 rounded-full">
                      {ANGLE_LABELS[script.angle] || script.angle}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCopy(script)}
                      className="p-1.5 text-dark-400 hover:text-dark-600 hover:bg-dark-50 rounded"
                      title="Copy"
                    >
                      {copiedId === script.id ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => handleExport(script)}
                      className="p-1.5 text-dark-400 hover:text-dark-600 hover:bg-dark-50 rounded"
                      title="Export"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(script.id)}
                      className="p-1.5 text-dark-400 hover:text-red-500 hover:bg-red-50 rounded"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-dark-600 whitespace-pre-wrap line-clamp-4">
                  {script.content}
                </p>
                <p className="text-xs text-dark-400 mt-3">
                  {new Date(script.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
