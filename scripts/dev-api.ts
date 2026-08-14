import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import tls from 'node:tls'
import { pathToFileURL } from 'node:url'

try {
  if (typeof tls.setDefaultCACertificates === 'function' && typeof tls.getCACertificates === 'function') {
    tls.setDefaultCACertificates([
      ...tls.getCACertificates('default'),
      ...tls.getCACertificates('system'),
    ])
  }
} catch (error) {
  console.warn('[dev-api] system CA store not applied', error)
}

const ROOT = resolve(process.cwd())
const API_ROOT = join(ROOT, 'api')
const PORT = Number(process.env.API_PORT || 3000)
const HOST = '127.0.0.1'
const MAX_BODY = 26 * 1024 * 1024

function loadEnvFile(file: string, override: boolean) {
  const path = join(ROOT, file)
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (override || !process.env[key]) process.env[key] = value
  }
}

loadEnvFile('.env', false)
loadEnvFile('.env.local', true)

function present(name: string): boolean {
  const value = process.env[name]?.trim()
  return Boolean(value) && !value.startsWith('your_')
}

type VercelLikeResponse = ServerResponse & {
  status: (code: number) => VercelLikeResponse
  json: (data: unknown) => VercelLikeResponse
  send: (data: unknown) => VercelLikeResponse
}

function wrapResponse(res: ServerResponse): VercelLikeResponse {
  const wrapped = res as VercelLikeResponse
  wrapped.status = (code: number) => {
    res.statusCode = code
    return wrapped
  }
  wrapped.json = (data: unknown) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
    return wrapped
  }
  wrapped.send = (data: unknown) => {
    if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
      return wrapped.json(data)
    }
    res.end(data as string | Buffer)
    return wrapped
  }
  return wrapped
}

async function readBody(req: IncomingMessage): Promise<{ raw: Buffer; json: unknown }> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > MAX_BODY) throw new Error('Payload too large')
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks)
  const type = String(req.headers['content-type'] || '')
  if (!raw.length || type.includes('multipart/form-data')) {
    return { raw, json: undefined }
  }
  if (type.includes('application/json') || type.includes('text/plain') || !type) {
    try {
      return { raw, json: JSON.parse(raw.toString('utf8')) }
    } catch {
      return { raw, json: undefined }
    }
  }
  return { raw, json: undefined }
}

function resolveHandlerPath(urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split('?')[0] || '')
  if (!clean.startsWith('/api/')) return null
  const relative = clean.slice('/api/'.length)
  if (!relative || relative.includes('..')) return null
  const withoutExt = relative.replace(/\.ts$/i, '')
  const candidate = normalize(join(API_ROOT, `${withoutExt}.ts`))
  if (!candidate.startsWith(API_ROOT) || extname(candidate) !== '.ts') return null
  return existsSync(candidate) ? candidate : null
}

const handlerCache = new Map<string, (req: IncomingMessage, res: VercelLikeResponse) => unknown>()

async function loadHandler(file: string) {
  const cached = handlerCache.get(file)
  if (cached) return cached
  const mod = await import(pathToFileURL(file).href) as { default?: (req: IncomingMessage, res: VercelLikeResponse) => unknown }
  if (typeof mod.default !== 'function') throw new Error(`No default handler in ${file}`)
  handlerCache.set(file, mod.default)
  return mod.default
}

function applyCors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
}

const server = createServer(async (req, res) => {
  const url = req.url || '/'
  const pathname = url.split('?')[0] || '/'
  applyCors(res)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (pathname === '/api/health') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      ok: true,
      grok: present('GROK_API_KEY'),
      gemini: present('GEMINI_API_KEY'),
      openai: present('OPENAI_API_KEY'),
      supabase: present('SUPABASE_URL') || present('VITE_SUPABASE_URL'),
      supabaseAdmin: present('SUPABASE_SECRET_KEY') || present('SUPABASE_SERVICE_ROLE_KEY'),
    }))
    return
  }

  const file = resolveHandlerPath(pathname)
  if (!file) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }

  try {
    const { json } = await readBody(req)
    Object.assign(req, { body: json, query: Object.fromEntries(new URL(url, 'http://127.0.0.1').searchParams) })
    const handler = await loadHandler(file)
    await handler(req, wrapResponse(res))
  } catch (error) {
    console.error('[dev-api]', pathname, error)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Local API error',
      }))
    }
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Local API http://${HOST}:${PORT}`)
  console.log(`GROK ${present('GROK_API_KEY') ? 'yes' : 'NO'} · GEMINI ${present('GEMINI_API_KEY') ? 'yes' : 'NO'} · OPENAI ${present('OPENAI_API_KEY') ? 'yes' : 'NO (voice off)'}`)
})
