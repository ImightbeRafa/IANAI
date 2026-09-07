/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Injected at build from process.env.VERCEL_ENV (preview | production | …). */
  readonly VITE_VERCEL_ENV?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
