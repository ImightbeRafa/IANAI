import { useMemo, useRef, useState } from 'react'
import { AlertCircle, FileUp, Image as ImageIcon, Upload, X } from 'lucide-react'
import type { Product } from '../../types'
import {
  isAllowedMcpIntakeFile,
  partitionMcpIntakeFiles,
  type ChatShellMcpIntakeIntent,
} from './chatShellMcpIntake'

const MAX_FILES = 5

type AssetKind = 'product' | 'context'

interface ChatShellMcpIntakeDialogProps {
  intent: ChatShellMcpIntakeIntent
  brandName: string
  products: Product[]
  language: 'en' | 'es'
  busy: boolean
  onClose: () => void
  onUploadFiles: (files: File[]) => Promise<void>
  onUploadAsset: (file: File, productId: string, kind: AssetKind) => Promise<void>
}

export default function ChatShellMcpIntakeDialog({
  intent,
  brandName,
  products,
  language,
  busy,
  onClose,
  onUploadFiles,
  onUploadAsset,
}: ChatShellMcpIntakeDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || '')
  const [assetKind, setAssetKind] = useState<AssetKind>('product')
  const es = language === 'es'

  const title = useMemo(() => {
    if (intent.mode === 'files') {
      return es ? 'Subir archivos GUIDE' : 'Upload GUIDE files'
    }
    if (intent.mode === 'asset') {
      return es ? 'Importar referencia' : 'Import reference asset'
    }
    return es ? 'Análisis de URL' : 'URL analysis'
  }, [es, intent.mode])

  const subtitle = useMemo(() => {
    if (intent.mode === 'files') {
      return es
        ? `Hasta ${MAX_FILES} PDF/imágenes para ${brandName}. Se usan para enriquecer el kit (sin créditos).`
        : `Up to ${MAX_FILES} PDF/images for ${brandName}. Used to enrich the brand kit (no credits).`
    }
    if (intent.mode === 'asset') {
      return es
        ? `Sube una imagen de producto/contexto a una oferta de ${brandName}. No se importan salidas externas de Grok.`
        : `Upload a product/context image onto an offer in ${brandName}. External Grok outputs are never imported.`
    }
    return es
      ? 'Esta marca tiene un intake de URL en curso. El worker lo completa en segundo plano.'
      : 'This brand has a URL intake in progress. The worker finishes it in the background.'
  }, [brandName, es, intent.mode])

  async function handleFilesChosen(list: FileList | null) {
    if (!list?.length || busy) return
    setError(null)
    const files = Array.from(list)
    if (intent.mode === 'files') {
      if (files.length > MAX_FILES) {
        setError(es
          ? `Máximo ${MAX_FILES} archivos`
          : `At most ${MAX_FILES} files`)
        return
      }
      const bad = files.filter((f) => !isAllowedMcpIntakeFile(f))
      if (bad.length) {
        setError(es ? 'Solo PDF e imágenes' : 'Only PDF and images are allowed')
        return
      }
      const parts = partitionMcpIntakeFiles(files)
      if (parts.rejected.length) {
        setError(es ? 'Algunos archivos no son válidos' : 'Some files are not allowed')
        return
      }
      try {
        await onUploadFiles([...parts.pdfs, ...parts.images])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      }
      return
    }

    if (intent.mode === 'asset') {
      const file = files[0]
      if (!file || !file.type.startsWith('image/')) {
        setError(es ? 'Selecciona una imagen' : 'Choose an image file')
        return
      }
      if (!selectedProductId) {
        setError(es ? 'Elige una oferta primero' : 'Pick an offer first')
        return
      }
      try {
        await onUploadAsset(file, selectedProductId, assetKind)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-lg rounded-2xl border border-dark-200 bg-dark-50 shadow-xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-dark-200">
          <div>
            <h2 className="text-lg font-semibold text-dark-900">{title}</h2>
            <p className="text-sm text-dark-500 mt-1">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-dark-400 hover:text-dark-700 hover:bg-dark-100"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-700/30 bg-red-900/20 p-3 text-sm text-red-400">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {intent.mode === 'url_status' && (
            <div className="rounded-lg border border-dark-200 bg-dark-100/40 p-4 text-sm text-dark-600">
              <p>
                {es ? 'Intake id:' : 'Intake id:'}{' '}
                <code className="text-xs break-all">{intent.requestId || intent.raw}</code>
              </p>
              <p className="mt-2">
                {es
                  ? 'Cuando termine, llama get_brand_context desde Grok para ver el kit enriquecido.'
                  : 'When finished, call get_brand_context from Grok to see the enriched kit.'}
              </p>
            </div>
          )}

          {intent.mode === 'asset' && (
            <div className="space-y-3">
              <label className="block text-sm text-dark-600">
                {es ? 'Oferta' : 'Offer'}
                <select
                  className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100/50 px-3 py-2 text-dark-900"
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  disabled={busy || products.length === 0}
                >
                  {products.length === 0 && (
                    <option value="">{es ? 'Sin ofertas — créala en el chat' : 'No offers — create one in chat'}</option>
                  )}
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-dark-600">
                {es ? 'Tipo' : 'Kind'}
                <select
                  className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100/50 px-3 py-2 text-dark-900"
                  value={assetKind}
                  onChange={(e) => setAssetKind(e.target.value as AssetKind)}
                  disabled={busy}
                >
                  <option value="product">{es ? 'Producto' : 'Product'}</option>
                  <option value="context">{es ? 'Contexto / escena' : 'Context / scene'}</option>
                </select>
              </label>
            </div>
          )}

          {(intent.mode === 'files' || intent.mode === 'asset') && (
            <>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                multiple={intent.mode === 'files'}
                accept={intent.mode === 'files' ? 'application/pdf,image/*' : 'image/*'}
                onChange={(e) => {
                  void handleFilesChosen(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                disabled={busy || (intent.mode === 'asset' && !selectedProductId)}
                onClick={() => fileRef.current?.click()}
                className="btn-primary w-full justify-center gap-2"
              >
                {intent.mode === 'files' ? <FileUp className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                {busy
                  ? (es ? 'Subiendo…' : 'Uploading…')
                  : (es ? 'Elegir archivos' : 'Choose files')}
              </button>
            </>
          )}

          {intent.mode === 'url_status' && (
            <button type="button" onClick={onClose} className="btn-primary w-full justify-center gap-2">
              <Upload className="w-4 h-4" />
              {es ? 'Entendido' : 'Got it'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
