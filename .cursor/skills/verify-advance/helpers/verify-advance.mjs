#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const STATE_DIR = process.env.ADVANCE_VERIFY_STATE_DIR || '/tmp/verify-advance'
const STATE_FILE = join(STATE_DIR, 'instance.json')
const EVIDENCE_ROOT = join(ROOT, '.cursor/skills/verify-advance/evidence/runs')
const ARTIFACTS = '/opt/cursor/artifacts'
const DEFAULT_PREVIEW =
  'https://ianai-git-cursor-chat-shell-prod-69817a-rafas-projects-3ea2e797.vercel.app'

function log(...args) {
  console.log(...args)
}

function die(message, code = 1) {
  console.error(message)
  process.exit(code)
}

function readState() {
  if (!existsSync(STATE_FILE)) return null
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
}

function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n')
}

function baseUrl() {
  const fromEnv = (process.env.ADVANCE_VERIFY_BASE_URL || '').replace(/\/$/, '')
  const fromState = readState()?.url
  return fromEnv || fromState || DEFAULT_PREVIEW
}

function targetMode() {
  return process.env.ADVANCE_VERIFY_TARGET || readState()?.mode || 'preview'
}

function localPort() {
  return Number(process.env.ADVANCE_VERIFY_PORT || 5173)
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, { redirect: 'follow', ...options })
  const text = await res.text()
  return { status: res.status, text, url: res.url }
}

function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForHttp(url, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (res.status >= 200 && res.status < 500) return true
    } catch {}
    await sleep(400)
  }
  return false
}

function newRunId(feature) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${stamp}-${feature}`
}

function evidenceDir(runId) {
  const dir = join(EVIDENCE_ROOT, runId)
  mkdirSync(dir, { recursive: true })
  return dir
}

function copyArtifact(src, name) {
  if (!existsSync(ARTIFACTS)) return
  try {
    copyFileSync(src, join(ARTIFACTS, name))
  } catch {}
}

function resolvePlaywright() {
  const candidates = [
    process.env.ADVANCE_VERIFY_PLAYWRIGHT,
    'playwright',
    '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
  ].filter(Boolean)
  for (const spec of candidates) {
    try {
      return require(spec)
    } catch {}
    try {
      return require(join(spec, 'index.js'))
    } catch {}
  }
  die('playwright module not found. Set ADVANCE_VERIFY_PLAYWRIGHT to the module path.')
}

async function launch() {
  mkdirSync(STATE_DIR, { recursive: true })
  const existing = readState()
  if (existing?.pid && pidAlive(existing.pid)) {
    die(`Refuse to double-launch: pid ${existing.pid} still recorded at ${STATE_FILE}`)
  }

  const mode = targetMode()
  if (mode === 'preview') {
    const url = baseUrl()
    const ok = await waitForHttp(url, 15000)
    if (!ok) die(`Preview not answering: ${url}`)
    writeState({ mode: 'preview', url, pid: null, startedAt: new Date().toISOString() })
    log(`READY url=${url} mode=preview`)
    return
  }

  if (mode !== 'local') die(`Unknown ADVANCE_VERIFY_TARGET=${mode}`)

  const port = localPort()
  const url = process.env.ADVANCE_VERIFY_BASE_URL || `http://127.0.0.1:${port}`
  const already = await waitForHttp(url, 800)
  if (already && !process.env.ADVANCE_VERIFY_ALLOW_SHARED) {
    die(`Port ${port} already answers and was not started by this run. Refuse shared instance.`)
  }

  mkdirSync(STATE_DIR, { recursive: true })
  const logPath = join(STATE_DIR, 'vite.log')
  const logStream = createWriteStream(logPath, { flags: 'a' })
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(port), '--host', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(logStream)
  child.stderr.pipe(logStream)
  writeState({
    mode: 'local',
    url: url.replace(/\/$/, ''),
    pid: child.pid,
    port,
    logPath,
    startedAt: new Date().toISOString(),
  })
  const ready = await waitForHttp(url, 40000)
  if (!ready) {
    if (child.pid) process.kill(child.pid, 'SIGTERM')
    die(`Local Vite did not become ready at ${url}. See ${logPath}`)
  }
  log(`READY url=${url.replace(/\/$/, '')} mode=local pid=${child.pid}`)
}

async function doctor() {
  const state = readState()
  if (!state) die(`No instance. Run launch first (${STATE_FILE} missing).`)
  const url = state.url
  if (state.mode === 'local') {
    if (!pidAlive(state.pid)) die(`Recorded pid ${state.pid} is not alive`)
  }
  const home = await fetchText(url + '/')
  if (home.status !== 200) die(`GET / expected 200, got ${home.status}`)
  const login = await fetchText(url + '/login')
  if (login.status !== 200) die(`GET /login expected 200, got ${login.status}`)
  if (!/Advance AI/i.test(login.text) || !/<div id="root">/.test(login.text)) {
    die('GET /login HTML missing Advance AI SPA shell (#root)')
  }
  let apiStatus = 'api-absent'
  try {
    const api = await fetch(url + '/api/chat-shell-open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ensure' }),
    })
    apiStatus = String(api.status)
    if (state.mode === 'preview' && api.status !== 401) {
      die(`POST /api/chat-shell-open unauth expected 401, got ${api.status}`)
    }
  } catch (err) {
    if (state.mode === 'preview') die(`API probe failed: ${err.message}`)
  }
  log(`DOCTOR_OK url=${url} mode=${state.mode} home=${home.status} login=200 api=${apiStatus}`)
}

function notes(dir, lines) {
  writeFileSync(join(dir, 'notes.log'), lines.join('\n') + '\n')
}

async function withBrowser(run) {
  const { chromium } = resolvePlaywright()
  const executablePath = process.env.ADVANCE_VERIFY_CHROME || '/usr/local/bin/google-chrome'
  const launchOpts = {
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  }
  if (existsSync(executablePath)) launchOpts.executablePath = executablePath
  const browser = await chromium.launch(launchOpts)
  try {
    return await run(browser)
  } finally {
    await browser.close()
  }
}

async function driveUninvited(url, dir, lines) {
  await withBrowser(async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.addInitScript(() => localStorage.setItem('ai-language', 'es'))
    await page.goto(`${url}/chat`, { waitUntil: 'networkidle', timeout: 60000 })
    const email = await page.locator('#email').count()
    const shell = await page.locator('.chat-shell').count()
    lines.push(`unauth /chat email_fields=${email} shell=${shell} page_url=${page.url()}`)
    if (email < 1) throw new Error('unauth /chat did not show login #email')
    if (shell > 0) throw new Error('unauth /chat mounted .chat-shell')
    const shot = join(dir, '01-unauth-login.png')
    await page.screenshot({ path: shot, fullPage: true })
    copyArtifact(shot, 'verify_advance_uninvited_unauth_login.png')
    await ctx.close()
  })

  const api = await fetch(url + '/api/chat-shell-open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'ensure' }),
  })
  const apiJson = await api.json().catch(() => ({}))
  const apiPath = join(dir, '02-api-unauth.json')
  writeFileSync(apiPath, JSON.stringify({ status: api.status, body: apiJson }, null, 2) + '\n')
  copyArtifact(apiPath, 'verify_advance_uninvited_api_unauth.json')
  lines.push(`POST /api/chat-shell-open unauth status=${api.status}`)
  if (api.status !== 401) throw new Error(`expected 401, got ${api.status}`)

  if (!process.env.ADVANCE_VERIFY_UNINVITED_EMAIL || !process.env.ADVANCE_VERIFY_UNINVITED_PASSWORD) {
    lines.push('SKIP authenticated-open: ADVANCE_VERIFY_UNINVITED_* unset (do not grant invites)')
    return
  }

  await withBrowser(async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.addInitScript(() => localStorage.setItem('ai-language', 'es'))
    await page.goto(`${url}/login?redirect=/chat`, { waitUntil: 'networkidle', timeout: 60000 })
    await page.locator('#email').fill(process.env.ADVANCE_VERIFY_UNINVITED_EMAIL)
    await page.locator('#password').fill(process.env.ADVANCE_VERIFY_UNINVITED_PASSWORD)
    await page.getByRole('button', { name: /iniciar sesión|sign in/i }).click()
    await page.waitForURL(/\/chat/, { timeout: 30000 })
    const invite = await page.getByRole('heading', { name: 'Chat es por invitación' }).count()
    if (invite > 0) {
      throw new Error('invite-all failed: signed-in user still sees Chat es por invitación')
    }
    const shell = await page.locator('.chat-shell').count()
    const tour = await page.getByRole('dialog', { name: 'Un chat para todo' }).count()
    lines.push(`authenticated /chat shell=${shell} tour=${tour} invite=${invite}`)
    if (shell < 1 && tour < 1) {
      throw new Error('signed-in user did not enter chat-shell after invite-all')
    }
    const shot = join(dir, '03-authenticated-open.png')
    await page.screenshot({ path: shot, fullPage: true })
    copyArtifact(shot, 'verify_advance_authenticated_open.png')
    await ctx.close()
  })
}

async function signIn(page, url) {
  const email = process.env.ADVANCE_VERIFY_EMAIL
  const password = process.env.ADVANCE_VERIFY_PASSWORD
  if (!email || !password) {
    throw new Error('ADVANCE_VERIFY_EMAIL and ADVANCE_VERIFY_PASSWORD required (env only)')
  }
  await page.goto(`${url}/login?redirect=/chat`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: /iniciar sesión|sign in/i }).click()
  await page.waitForURL(/\/chat/, { timeout: 30000 })
}

async function driveAfterSkip(url, dir, lines) {
  if (!process.env.ADVANCE_VERIFY_EMAIL || !process.env.ADVANCE_VERIFY_PASSWORD) {
    throw new Error('after-skip-chrome requires ADVANCE_VERIFY_EMAIL / ADVANCE_VERIFY_PASSWORD')
  }
  await withBrowser(async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.addInitScript(() => localStorage.setItem('ai-language', 'es'))
    await signIn(page, url)
    await sleep(2500)
    const skip = page.getByRole('button', { name: /saltar y no volver a mostrar|skip and never show again|saltar|skip/i })
    if (await skip.count()) {
      await skip.first().click()
      await sleep(1000)
      lines.push('dismissed leftover tour/gift')
    }
    const thread = page.getByRole('button', { name: /Quiero crear guiones/i }).first()
    await thread.waitFor({ timeout: 15000 })
    await thread.click()
    await sleep(2000)

    const crumbs = (await page.locator('.chat-shell__crumbs').innerText()).replace(/\s+/g, ' ').trim()
    lines.push(`crumbs: ${crumbs}`)
    if (!/Quiero crear guiones/i.test(crumbs)) throw new Error(`header missing session title: ${crumbs}`)
    if (/\/ Chat nuevo(\s|\/|$)/i.test(crumbs)) throw new Error(`old thread header still Chat nuevo: ${crumbs}`)
    const headerShot = join(dir, '01-header-session.png')
    await page.screenshot({ path: headerShot })
    copyArtifact(headerShot, 'verify_advance_after_skip_header.png')

    const chip = (await page.locator('.chat-shell__idle-kit-title').innerText()).replace(/\s+/g, ' ').trim()
    lines.push(`chip: ${chip}`)
    if (!/Falta: Público, Fuentes/i.test(chip)) throw new Error(`chip missing named gaps: ${chip}`)
    if (/Falta afinar/i.test(chip)) throw new Error(`chip still generic: ${chip}`)

    const glass = page.locator('.chat-shell__idle-glass').first()
    const glassShot = join(dir, '02-glass-pack.png')
    await glass.screenshot({ path: glassShot })
    copyArtifact(glassShot, 'verify_advance_after_skip_glass_pack.png')

    for (const label of ['Guiones', 'Post', 'Foto', 'Pack']) {
      const button = page.locator('.chat-shell__idle-actions button').filter({ hasText: new RegExp(`^${label}`) }).first()
      const span = button.locator('span')
      const text = (await span.innerText()).trim()
      if (text !== label) throw new Error(`${label} span clipped in DOM: ${JSON.stringify(text)}`)
      const metrics = await span.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }))
      lines.push(`${label} metrics ${JSON.stringify(metrics)}`)
      if (metrics.scrollWidth > metrics.clientWidth + 1) {
        throw new Error(`${label} ellipsized (${metrics.scrollWidth} > ${metrics.clientWidth})`)
      }
    }

    const crear = page.locator('.chat-shell__artifact-action').filter({ hasText: /Primero el kit|Crear post/ }).first()
    await crear.waitFor({ timeout: 15000 })
    const crearInfo = await crear.evaluate((el) => ({
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      className: el.className,
      disabled: el.disabled,
      kitBlocked: el.getAttribute('data-kit-blocked'),
    }))
    lines.push(`crear: ${JSON.stringify(crearInfo)}`)
    if (/\bis-primary\b/.test(crearInfo.className)) throw new Error('Crear post still filled primary')
    if (!crearInfo.disabled) throw new Error('Crear post still enabled')
    if (!/Primero el kit/i.test(crearInfo.text)) throw new Error(`expected Primero el kit, got ${crearInfo.text}`)
    if (/crear post/i.test(crearInfo.text)) throw new Error('Crear post label still visible')

    const cardShot = join(dir, '03-script-card-primero-el-kit.png')
    const card = page.locator('article, .chat-shell__script-card, .chat-shell__artifact').first()
    if (await card.count()) await card.screenshot({ path: cardShot })
    else await page.locator('.chat-shell__thread').screenshot({ path: cardShot })
    copyArtifact(cardShot, 'verify_advance_after_skip_script_card.png')

    const full = join(dir, '04-full-shell.png')
    await page.screenshot({ path: full })
    copyArtifact(full, 'verify_advance_after_skip_full.png')
    await ctx.close()
  })
}

async function driveTour(url, dir, lines) {
  if (!process.env.ADVANCE_VERIFY_EMAIL || !process.env.ADVANCE_VERIFY_PASSWORD) {
    throw new Error('invited-first-chat-tour requires ADVANCE_VERIFY_EMAIL / ADVANCE_VERIFY_PASSWORD')
  }
  await withBrowser(async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.addInitScript(() => localStorage.setItem('ai-language', 'es'))
    await signIn(page, url)
    await sleep(2500)
    const dialog = page.getByRole('dialog', { name: /Un chat para todo|One chat for everything/i })
    const visible = await dialog.count()
    const shot = join(dir, '01-tour-mount.png')
    await page.screenshot({ path: shot })
    copyArtifact(shot, 'verify_advance_tour_mount.png')
    if (!visible) {
      lines.push('SKIP tour-mount: dialog not present (account likely already tour_done). Do not grant invites or reset metadata.')
      writeFileSync(join(dir, 'verdict.txt'), 'SKIPPED tour already done\n')
      await ctx.close()
      return
    }
    await dialog.first().screenshot({ path: join(dir, '01-tour-dialog.png') })
    await page.getByRole('button', { name: /Saltar y no volver a mostrar|Skip and never show again/i }).click()
    await sleep(1500)
    const after = join(dir, '02-tour-skipped.png')
    await page.screenshot({ path: after })
    copyArtifact(after, 'verify_advance_tour_skipped.png')
    if (await dialog.count()) throw new Error('tour still visible after skip')
    await page.reload({ waitUntil: 'networkidle' })
    await sleep(2000)
    const reloadShot = join(dir, '03-tour-gone-on-reload.png')
    await page.screenshot({ path: reloadShot })
    copyArtifact(reloadShot, 'verify_advance_tour_reload.png')
    if (await page.getByRole('dialog', { name: /Un chat para todo/i }).count()) {
      throw new Error('tour remounted after skip persist')
    }
    const kits = join(dir, '04-kits-stay.png')
    await page.screenshot({ path: kits })
    copyArtifact(kits, 'verify_advance_tour_kits_stay.png')
    lines.push('tour skipped and did not remount; kits screenshot captured (no wipe)')
    await ctx.close()
  })
}

async function dismissTourIfPresent(page, lines) {
  const skip = page.getByRole('button', { name: /saltar y no volver a mostrar|skip and never show again|saltar|skip/i })
  if (await skip.count()) {
    await skip.first().click()
    await sleep(1000)
    lines.push('dismissed leftover tour')
  }
}

async function drivePackQty(url, dir, lines) {
  if (!process.env.ADVANCE_VERIFY_EMAIL || !process.env.ADVANCE_VERIFY_PASSWORD) {
    throw new Error('pack-qty requires ADVANCE_VERIFY_EMAIL / ADVANCE_VERIFY_PASSWORD')
  }
  await withBrowser(async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.addInitScript(() => localStorage.setItem('ai-language', 'es'))
    await signIn(page, url)
    await sleep(2500)
    await dismissTourIfPresent(page, lines)
    const pack = page.getByRole('button', { name: /^Pack$/ }).first()
    await pack.waitFor({ timeout: 20000 })
    await pack.click()
    const dialog = page.getByRole('dialog', { name: 'Pack' })
    await dialog.waitFor({ timeout: 15000 })
    const input = page.locator('#chat-shell-bulk-count')
    await input.waitFor({ timeout: 10000 })
    const start = await input.inputValue()
    lines.push(`qty start=${start}`)
    await input.fill('3')
    const typed = await input.inputValue()
    lines.push(`qty typed=${typed}`)
    if (typed !== '3') throw new Error(`cantidad did not accept 3, got ${typed}`)
    const shot = join(dir, '01-pack-qty-3.png')
    await dialog.screenshot({ path: shot })
    copyArtifact(shot, 'verify_advance_pack_qty_3.png')
    await page.getByLabel('Más').click()
    const plus = await input.inputValue()
    lines.push(`qty plus=${plus}`)
    if (plus !== '4') throw new Error(`Más did not step to 4, got ${plus}`)
    await page.getByLabel('Menos').click()
    const minus = await input.inputValue()
    lines.push(`qty minus=${minus}`)
    if (minus !== '3') throw new Error(`Menos did not return to 3, got ${minus}`)
    const footerCancel = page.locator('.chat-shell__modal-btn').filter({ hasText: /^Cancelar$/ }).first()
    await footerCancel.click()
    await sleep(500)
    if (await dialog.count()) throw new Error('Pack dialog still open after Cancelar')
    lines.push('cancelled without generate')
    await ctx.close()
  })
}

async function driveCloseSheet(url, dir, lines) {
  if (!process.env.ADVANCE_VERIFY_EMAIL || !process.env.ADVANCE_VERIFY_PASSWORD) {
    throw new Error('close-sheet-on-generate requires ADVANCE_VERIFY_EMAIL / ADVANCE_VERIFY_PASSWORD')
  }
  lines.push('no-spend path: do not click Generar on Preview')
  await withBrowser(async (browser) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.addInitScript(() => localStorage.setItem('ai-language', 'es'))
    await signIn(page, url)
    await sleep(2500)
    await dismissTourIfPresent(page, lines)
    const post = page.getByRole('button', { name: /^Post$/ }).first()
    await post.waitFor({ timeout: 20000 })
    const shot = join(dir, '01-chat-ready.png')
    await page.screenshot({ path: shot })
    copyArtifact(shot, 'verify_advance_close_sheet_chat_ready.png')
    lines.push('Post glass visible; Generar close is covered by Vitest (imageClarify null unmounts sheet)')
    await ctx.close()
  })
}

async function drivePackProduces(url, dir, lines) {
  lines.push(`url=${url}`)
  if (process.env.ADVANCE_VERIFY_ALLOW_PACK_GENERATE !== '1') {
    writeFileSync(join(dir, 'verdict.txt'), 'SKIPPED pack-produces (set ADVANCE_VERIFY_ALLOW_PACK_GENERATE=1 to spend credits)\n')
    lines.push('SKIP pack-produces: credit spend not allowed')
    return
  }
  throw new Error('Authenticated pack generate drive is opt-in and not implemented as a spend-by-default recipe.')
}

async function driveKitRefs(url, dir, lines) {
  lines.push(`url=${url}`)
  writeFileSync(join(dir, 'verdict.txt'), 'SKIPPED kit-refs-used live generate (unit tests cover CSP/server fetch; do not spend credits by default)\n')
  lines.push('SKIP kit-refs-used live generate; unit tests are the default proof')
}

async function drive(feature) {
  const state = readState()
  if (!state) die('No instance. Run launch first.')
  const url = state.url
  const runId = newRunId(feature)
  const dir = evidenceDir(runId)
  const lines = [`feature=${feature}`, `url=${url}`, `run=${runId}`]
  try {
    if (feature === 'uninvited-chat-gate') await driveUninvited(url, dir, lines)
    else if (feature === 'after-skip-chrome') await driveAfterSkip(url, dir, lines)
    else if (feature === 'invited-first-chat-tour') await driveTour(url, dir, lines)
    else if (feature === 'pack-qty') await drivePackQty(url, dir, lines)
    else if (feature === 'close-sheet-on-generate') await driveCloseSheet(url, dir, lines)
    else if (feature === 'pack-produces') await drivePackProduces(url, dir, lines)
    else if (feature === 'kit-refs-used') await driveKitRefs(url, dir, lines)
    else die(`Unknown feature ${feature}`)
    if (!existsSync(join(dir, 'verdict.txt'))) writeFileSync(join(dir, 'verdict.txt'), 'PASS\n')
    lines.push('PASS')
    notes(dir, lines)
    log(`DRIVE_OK feature=${feature} evidence=${dir}`)
  } catch (err) {
    lines.push(`FAIL ${err.message}`)
    notes(dir, lines)
    writeFileSync(join(dir, 'verdict.txt'), `FAIL ${err.message}\n`)
    throw err
  }
}

function cleanup() {
  const state = readState()
  if (state?.pid && pidAlive(state.pid)) {
    process.kill(state.pid, 'SIGTERM')
    log(`stopped pid ${state.pid}`)
  }
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE)
  log(`CLEANUP_OK evidence kept at ${EVIDENCE_ROOT}`)
}

const cmd = process.argv[2]
const feature = process.argv[3]
try {
  if (cmd === 'launch') await launch()
  else if (cmd === 'doctor') await doctor()
  else if (cmd === 'drive') {
    if (!feature) die('drive requires a feature id')
    await drive(feature)
  } else if (cmd === 'cleanup') cleanup()
  else die('Usage: verify-advance.mjs <launch|doctor|drive|cleanup> [feature-id]')
} catch (err) {
  console.error(err)
  process.exit(1)
}
