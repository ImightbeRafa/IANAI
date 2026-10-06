#!/usr/bin/env node
// Plain node:http adapter that runs the existing Vercel-style `api/**` handlers
// inside a Cloudflare Container. Reproduces the parts of @vercel/node's
// addHelpers (req.query, req.cookies, lazy req.body, res.status/json/send/redirect)
// that the handlers in this repo actually rely on. No framework dependencies.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { parse as parseQS } from 'node:querystring'
import { PassThrough } from 'node:stream'
import { pathToFileURL } from 'node:url'
import {
  SECURITY_HEADERS,
  HTML_NO_CACHE,
  rewriteToApi,
  isApiPath,
  isSpaFallbackPath,
  parseSizeLimit,
} from './cf/http-rules.mjs'

const DEFAULT_BODY_LIMIT = 4_718_592
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/
const DISALLOWED_FIRST_SEGMENTS = new Set(['lib', 'data', 'types'])

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Background work tracking (replaces Vercel's per-request waitUntil context
// with a single process-wide one; see @vercel/functions/get-context.js).
// ---------------------------------------------------------------------------

const pending = new Set()

function track(p) {
  const entry = Promise.resolve(p)
    .catch((err) => console.error('[server] waitUntil rejected', err?.message ?? err))
    .finally(() => pending.delete(entry))
  pending.add(entry)
}

export function pendingBackgroundCount() {
  return pending.size
}

function installBackgroundContext() {
  Object.defineProperty(globalThis, Symbol.for('@vercel/request-context'), {
    enumerable: false,
    configurable: true,
    value: { get: () => ({ waitUntil: track }) },
  })
}

process.on('unhandledRejection', (err) => console.error('[server] unhandledRejection', err?.message ?? err))
process.on('uncaughtException', (err) => console.error('[server] uncaughtException', err?.stack ?? err))

// ---------------------------------------------------------------------------
// Vercel-compatible request/response helpers.
// ---------------------------------------------------------------------------

function parseQuery(search) {
  if (!search || search === '?') return {}
  return parseQS(search.slice(1))
}

function parseCookies(header) {
  const out = {}
  if (!header) return out
  const str = Array.isArray(header) ? header.join(';') : header
  for (const part of str.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    if (!key || Object.prototype.hasOwnProperty.call(out, key)) continue
    let val = part.slice(idx + 1).trim()
    if (val.length >= 2 && val[0] === '"' && val[val.length - 1] === '"') {
      val = val.slice(1, -1)
    }
    if (val.includes('%')) {
      try {
        val = decodeURIComponent(val)
      } catch {
        // keep the raw value
      }
    }
    out[key] = val
  }
  return out
}

function setLazyProp(req, prop, getter) {
  const opts = { configurable: true, enumerable: true }
  const optsReset = { ...opts, writable: true }
  Object.defineProperty(req, prop, {
    ...opts,
    get: () => {
      const value = getter()
      Object.defineProperty(req, prop, { ...optsReset, value })
      return value
    },
    set: (value) => {
      Object.defineProperty(req, prop, { ...optsReset, value })
    },
  })
}

// Deviation from Vercel's throwing `content-type` parser: a cheap split instead.
function normalizeContentType(ct) {
  return ct.split(';')[0].trim().toLowerCase()
}

function parseBodyBuffer(buf, contentTypeHeader) {
  const type = normalizeContentType(contentTypeHeader)
  if (type === 'application/json') {
    const str = buf.toString('utf8')
    if (!str) return {}
    try {
      return JSON.parse(str)
    } catch {
      throw new ApiError(400, 'Invalid JSON')
    }
  }
  if (type === 'application/octet-stream') return buf
  if (type === 'application/x-www-form-urlencoded') return parseQS(buf.toString('utf8'))
  if (type === 'text/plain') return buf.toString('utf8')
  return undefined
}

// Copied from @vercel/node's serverless-functions/helpers.ts restoreBody: a
// PassThrough replay so handlers that read req.on('data'|'end') still work
// after we've already buffered the body once.
function restoreBody(req, body) {
  const replicateBody = new PassThrough()
  const on = replicateBody.on.bind(replicateBody)
  const originalOn = req.on.bind(req)
  req.read = replicateBody.read.bind(replicateBody)
  req.on = req.addListener = (name, cb) => (name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb))
  replicateBody.write(body)
  replicateBody.end()
}

function readLimitedBody(req, limit) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = []
    let total = 0
    let finished = false
    const onData = (chunk) => {
      if (finished) return
      total += chunk.length
      if (total > limit) {
        finished = true
        req.removeListener('data', onData)
        req.removeListener('end', onEnd)
        req.resume()
        resolvePromise({ tooLarge: true })
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      if (finished) return
      finished = true
      resolvePromise({ tooLarge: false, buffer: Buffer.concat(chunks) })
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', rejectPromise)
  })
}

function setCharset(type, charset) {
  if (/charset=/i.test(type)) return type
  return `${type}; charset=${charset}`
}

function sendBody(req, res, body) {
  let chunk = body
  let encoding
  switch (typeof chunk) {
    case 'string':
      if (!res.getHeader('content-type')) res.setHeader('content-type', 'text/html')
      break
    case 'boolean':
    case 'number':
    case 'object':
      if (chunk === null) {
        chunk = ''
      } else if (Buffer.isBuffer(chunk)) {
        if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/octet-stream')
      } else {
        if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8')
        return sendBody(req, res, JSON.stringify(chunk))
      }
      break
    default:
      break
  }
  if (typeof chunk === 'string') {
    encoding = 'utf8'
    const type = res.getHeader('content-type')
    if (typeof type === 'string') res.setHeader('content-type', setCharset(type, 'utf-8'))
  }
  let len
  if (chunk !== undefined) {
    if (Buffer.isBuffer(chunk)) len = chunk.length
    else if (typeof chunk === 'string') len = Buffer.byteLength(chunk, encoding)
    if (len !== undefined) res.setHeader('content-length', len)
  }
  if (res.statusCode === 204 || res.statusCode === 304) {
    res.removeHeader('Content-Type')
    res.removeHeader('Content-Length')
    res.removeHeader('Transfer-Encoding')
    chunk = ''
  }
  if (req.method === 'HEAD') {
    res.end()
  } else if (encoding) {
    res.end(chunk, encoding)
  } else {
    res.end(chunk)
  }
  return res
}

function augmentResponse(req, res) {
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.redirect = (a, b) => {
    let status = 307
    let url = a
    if (typeof a === 'number') {
      status = a
      url = b
    }
    if (typeof status !== 'number' || typeof url !== 'string') {
      throw new Error(
        "Invalid redirect arguments. Please use a single argument URL, e.g. res.redirect('/destination') or use a status code and URL, e.g. res.redirect(307, '/destination')."
      )
    }
    res.writeHead(status, { Location: url }).end()
    return res
  }
  res.send = (body) => sendBody(req, res, body)
  res.json = (body) => {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8')
    return sendBody(req, res, JSON.stringify(body))
  }
}

function sendJson(res, status, obj) {
  if (res.headersSent) {
    res.end()
    return
  }
  const body = JSON.stringify(obj)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

// ---------------------------------------------------------------------------
// Static file serving.
// ---------------------------------------------------------------------------

const STATIC_CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
}

function contentTypeFor(filePath) {
  return STATIC_CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

async function serveStaticFile(req, res, filePath, cacheControl) {
  const data = await readFile(filePath)
  res.statusCode = 200
  res.setHeader('content-type', contentTypeFor(filePath))
  res.setHeader('cache-control', cacheControl)
  res.setHeader('content-length', data.length)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(data)
}

function isExistingFile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

async function handleStatic(req, res, pathname, staticDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  let decodedPath
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    sendJson(res, 404, { error: 'Not found' })
    return
  }
  if (decodedPath.includes('\0')) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }

  if (pathname === '/') {
    const indexPath = join(staticDir, 'index.html')
    if (existsSync(indexPath)) {
      await serveStaticFile(req, res, indexPath, HTML_NO_CACHE)
      return
    }
    sendJson(res, 404, { error: 'Not found' })
    return
  }

  const resolvedStaticDir = resolve(staticDir)
  const candidate = resolve(staticDir, '.' + decodedPath)
  const insideStaticDir = candidate === resolvedStaticDir || candidate.startsWith(resolvedStaticDir + sep)
  if (insideStaticDir && isExistingFile(candidate)) {
    const ext = extname(candidate).toLowerCase()
    const cacheControl = ext === '.html' ? HTML_NO_CACHE : 'public, max-age=0, must-revalidate'
    await serveStaticFile(req, res, candidate, cacheControl)
    return
  }

  if (isSpaFallbackPath(pathname)) {
    const indexPath = join(staticDir, 'index.html')
    if (existsSync(indexPath)) {
      await serveStaticFile(req, res, indexPath, HTML_NO_CACHE)
      return
    }
  }

  sendJson(res, 404, { error: 'Not found' })
}

// ---------------------------------------------------------------------------
// API routing.
// ---------------------------------------------------------------------------

function resolveApiFile(apiDir, target) {
  let rest = target.slice('/api/'.length)
  if (rest.endsWith('/')) rest = rest.slice(0, -1)
  const segs = rest.split('/')
  if (segs.some((s) => !SEGMENT_RE.test(s))) return null
  if (DISALLOWED_FIRST_SEGMENTS.has(segs[0])) return null
  const file = join(apiDir, ...segs) + '.js'
  if (!isExistingFile(file)) return null
  return file
}

async function setupRequestBody(req, mod) {
  const bodyParserConfig = mod.config?.api?.bodyParser

  setLazyProp(req, 'query', () => parseQuery(req.__cfUrl.search))
  setLazyProp(req, 'cookies', () => parseCookies(req.headers.cookie))

  if (bodyParserConfig === false) {
    req.body = undefined
    return { tooLarge: false }
  }

  let limit = DEFAULT_BODY_LIMIT
  try {
    limit = parseSizeLimit(bodyParserConfig?.sizeLimit ?? DEFAULT_BODY_LIMIT)
  } catch (err) {
    console.error('[server] invalid sizeLimit, using default', err?.message ?? err)
  }

  const contentTypeHeader = req.headers['content-type']
  if (contentTypeHeader === undefined) {
    setLazyProp(req, 'body', () => '')
    return { tooLarge: false }
  }

  const contentLengthHeader = req.headers['content-length']
  if (contentLengthHeader !== undefined && Number(contentLengthHeader) > limit) {
    req.resume()
    return { tooLarge: true }
  }

  const result = await readLimitedBody(req, limit)
  if (result.tooLarge) return { tooLarge: true }

  restoreBody(req, result.buffer)
  setLazyProp(req, 'body', () => parseBodyBuffer(result.buffer, contentTypeHeader))
  return { tooLarge: false }
}

export function createRequestHandler({ apiDir, staticDir }) {
  const moduleCache = new Map()

  function loadApiModule(file) {
    let p = moduleCache.get(file)
    if (!p) {
      p = import(pathToFileURL(file).href)
      moduleCache.set(file, p)
    }
    return p
  }

  return async function handleRequest(req, res) {
    for (const [name, value] of SECURITY_HEADERS) res.setHeader(name, value)

    const url = new URL(req.url, 'http://localhost')
    const pathname = url.pathname
    req.__cfUrl = url

    if (pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'advance-ai-api',
        appEnv: process.env.APP_ENV || process.env.VERCEL_ENV || '',
        pendingBackground: pending.size,
        uptimeSec: Math.round(process.uptime()),
      })
      return
    }

    const target = rewriteToApi(pathname) ?? pathname

    if (isApiPath(target)) {
      const file = resolveApiFile(apiDir, target)
      if (!file) {
        sendJson(res, 404, { error: 'Not found' })
        return
      }

      let mod
      try {
        mod = await loadApiModule(file)
      } catch (err) {
        moduleCache.delete(file)
        console.error('[server] handler error', target, err?.message ?? err)
        sendJson(res, 500, { error: 'Internal Server Error' })
        return
      }
      if (typeof mod.default !== 'function') {
        sendJson(res, 404, { error: 'Not found' })
        return
      }

      const bodyResult = await setupRequestBody(req, mod)
      if (bodyResult.tooLarge) {
        sendJson(res, 413, { error: 'Payload too large' })
        return
      }

      augmentResponse(req, res)
      try {
        await mod.default(req, res)
      } catch (err) {
        if (err && err.statusCode === 400 && err.message === 'Invalid JSON') {
          sendJson(res, 400, { error: 'Invalid JSON' })
          return
        }
        console.error('[server] handler error', target, err?.message ?? err)
        if (!res.headersSent) sendJson(res, 500, { error: 'Internal Server Error' })
        else res.end()
      }
      return
    }

    await handleStatic(req, res, target, staticDir)
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle.
// ---------------------------------------------------------------------------

let shuttingDown = false

async function shutdown(server, drainMs) {
  if (shuttingDown) return
  shuttingDown = true
  console.log('[server] shutting down')
  server.close()
  server.closeIdleConnections?.()
  const n = pending.size
  const outcome = await Promise.race([
    Promise.allSettled([...pending]).then(() => 'settled'),
    sleep(drainMs).then(() => 'timeout'),
  ])
  if (outcome === 'settled') {
    console.log(`[server] drained ${n} background task(s)`)
  } else {
    console.log(`[server] drain timeout with ${pending.size} pending`)
  }
  process.exit(0)
}

export async function startServer({
  port = Number(process.env.PORT ?? 8080),
  host = process.env.HOST ?? '0.0.0.0',
  apiDir = process.env.API_DIR ?? './dist-api',
  staticDir = process.env.STATIC_DIR ?? './dist',
  drainMs = Number(process.env.SHUTDOWN_DRAIN_MS ?? 300000),
} = {}) {
  installBackgroundContext()

  const handleRequest = createRequestHandler({ apiDir, staticDir })
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[server] unhandled request error', err?.message ?? err)
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal Server Error' })
      else res.end()
    })
  })
  server.keepAliveTimeout = 65000

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, host, () => {
      server.removeListener('error', rejectPromise)
      resolvePromise()
    })
  })

  const actualPort = server.address().port
  console.log(`[server] listening on http://${host}:${actualPort}`)

  process.on('SIGTERM', () => shutdown(server, drainMs))
  process.on('SIGINT', () => shutdown(server, drainMs))

  const close = () => new Promise((r) => server.close(() => r()))
  return { server, port: actualPort, close }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
}
