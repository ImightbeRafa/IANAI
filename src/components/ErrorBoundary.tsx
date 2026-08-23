import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  retryCount: number
  isChunkError: boolean
}

const CHUNK_RELOAD_KEY = 'advance.chunk_reload'

// DOM errors injected by browser extensions (Google Translate, Grammarly, etc.)
const isDOMExtensionError = (error: Error): boolean => {
  const msg = error.message || ''
  return (
    msg.includes('insertBefore') ||
    msg.includes('removeChild') ||
    (msg.includes('Failed to execute') && msg.includes('on \'Node\''))
  )
}

/** Stale deploy: old HTML asks for hashed /assets/* that no longer exist. */
const isChunkLoadError = (error: Error): boolean => {
  const msg = `${error.name} ${error.message}`
  return (
    /Failed to fetch dynamically imported module/i.test(msg)
    || /Loading chunk [\d]+ failed/i.test(msg)
    || /ChunkLoadError/i.test(msg)
    || /Importing a module script failed/i.test(msg)
  )
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, retryCount: 0, isChunkError: false }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, isChunkError: isChunkLoadError(error) }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Auto-recover from DOM errors caused by browser extensions (e.g. Google Translate)
    if (isDOMExtensionError(error) && this.state.retryCount < 3) {
      console.warn('ErrorBoundary: DOM extension error detected, auto-recovering…', error.message)
      this.setState(prev => ({ hasError: false, error: null, retryCount: prev.retryCount + 1 }))
      return
    }

    // One hard reload after a deploy replaced hashed chunks
    if (isChunkLoadError(error)) {
      try {
        const already = sessionStorage.getItem(CHUNK_RELOAD_KEY)
        if (!already) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
          window.location.reload()
          return
        }
      } catch {
        // sessionStorage blocked — fall through to UI
      }
    }

    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  handleReset = () => {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY)
    } catch {
      // ignore
    }
    this.setState({ hasError: false, error: null, retryCount: 0, isChunkError: false })
    if (this.state.isChunkError) {
      window.location.href = `${window.location.pathname}${window.location.search}`
      return
    }
    window.location.href = '/dashboard'
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-dark-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-900/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-xl font-bold text-dark-900 mb-2">
              {this.state.isChunkError ? 'Actualización disponible' : 'Algo salió mal'}
            </h1>
            <p className="text-dark-500 text-sm mb-6">
              {this.state.isChunkError
                ? 'Hay una versión nueva de Advance. Recarga la página para continuar.'
                : 'Ocurrió un error inesperado. Por favor intenta de nuevo.'}
            </p>
            {this.state.error && !this.state.isChunkError && (
              <pre className="text-xs text-dark-400 bg-dark-100 rounded-lg p-3 mb-6 text-left overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              {this.state.isChunkError ? 'Recargar' : 'Volver al inicio'}
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
