import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ConfigErrorScreen from './components/ConfigErrorScreen'
import { getSupabaseConfigError, isSupabaseConfigured } from './lib/supabase'
import './index.css'

if (import.meta.env.PROD) {
  const noop = () => {}
  console.log = noop
  console.info = noop
  console.debug = noop
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Missing #root element')
}

const configError = isSupabaseConfigured ? null : getSupabaseConfigError()

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    {configError ? <ConfigErrorScreen message={configError} /> : <App />}
  </React.StrictMode>,
)
