/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Injected at build from process.env.VERCEL_ENV (preview | production | …). */
  readonly VITE_VERCEL_ENV?: string
  /** Injected at build from VITE_APP_ENV, else APP_ENV, else VERCEL_ENV (preview | production | …). Platform-agnostic successor to VITE_VERCEL_ENV. */
  readonly VITE_APP_ENV?: string
  /** Comma-separated exact-match hostnames treated as Preview (e.g. a Cloudflare preview Worker hostname). */
  readonly VITE_PREVIEW_HOSTS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
