import { Component, ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  retryCount: number
}

// DOM errors injected by browser extensions (Google Translate, Grammarly, etc.)
const isDOMExtensionError = (error: Error): boolean => {
  const msg = error.message || ''
  return (
    msg.includes('insertBefore') ||
    msg.includes('removeChild') ||
    (msg.includes('Failed to execute') && msg.includes('on \'Node\''))
  )
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, retryCount: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Auto-recover from DOM errors caused by browser extensions (e.g. Google Translate)
    if (isDOMExtensionError(error) && this.state.retryCount < 3) {
      console.warn('ErrorBoundary: DOM extension error detected, auto-recovering…', error.message)
      this.setState(prev => ({ hasError: false, error: null, retryCount: prev.retryCount + 1 }))
      return
    }
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, retryCount: 0 })
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
            <h1 className="text-xl font-bold text-dark-900 mb-2">Algo salió mal</h1>
            <p className="text-dark-500 text-sm mb-6">
              Ocurrió un error inesperado. Por favor intenta de nuevo.
            </p>
            {this.state.error && (
              <pre className="text-xs text-dark-400 bg-dark-100 rounded-lg p-3 mb-6 text-left overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Volver al inicio
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
