import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Expose the deployment env class to the SPA (preview vs production). Not a secret.
  define: {
    'import.meta.env.VITE_VERCEL_ENV': JSON.stringify(process.env.VERCEL_ENV ?? ''),
    'import.meta.env.VITE_APP_ENV': JSON.stringify(
      process.env.VITE_APP_ENV || process.env.APP_ENV || process.env.VERCEL_ENV || ''
    ),
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
  },
})
