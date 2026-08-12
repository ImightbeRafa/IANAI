interface ConfigErrorScreenProps {
  message: string
}

/**
 * Visible fail-soft UI when Vite env is missing in a production/preview deploy.
 * Prefer this over an empty #root (blank dark body from index.css).
 */
export default function ConfigErrorScreen({ message }: ConfigErrorScreenProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: '#0d1117',
        color: '#e2e8f0',
        fontFamily: 'IBM Plex Sans, Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          width: 'min(520px, 100%)',
          background: '#151d28',
          border: '1px solid #2a3a52',
          borderRadius: 12,
          padding: '28px 24px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: '1.15rem', marginBottom: 8, letterSpacing: '-0.02em' }}>
          Advance AI — configuration error
        </div>
        <p style={{ margin: '0 0 16px', color: '#9aa3b5', lineHeight: 1.5, fontSize: '0.95rem' }}>
          The app could not start because Supabase environment variables are missing
          in this deployment. This usually means Preview env vars were not set
          (or are scoped only to Production).
        </p>
        <pre
          style={{
            margin: '0 0 16px',
            padding: 12,
            borderRadius: 8,
            background: '#0d1117',
            color: '#fca5a5',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
          }}
        >
          {message}
        </pre>
        <div style={{ color: '#9aa3b5', fontSize: '0.85rem', lineHeight: 1.55 }}>
          <strong style={{ color: '#e2e8f0' }}>Required (Vercel → Preview):</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            <li><code>VITE_SUPABASE_URL</code> = <code>https://adrwkzibhfdpwuycnzaa.supabase.co</code></li>
            <li><code>VITE_SUPABASE_ANON_KEY</code> or <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> from IANAI-preview</li>
          </ul>
          <p style={{ margin: '12px 0 0' }}>
            Pair frontend + backend keys to the same project. Do not point Preview at production AIIAN.
            After saving env vars, trigger a new Preview redeploy.
          </p>
        </div>
      </div>
    </div>
  )
}
