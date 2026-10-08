import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve } from 'node:path'

export interface AdapterHandle {
  baseUrl: string
  proc: ChildProcessWithoutNullStreams
  output(): string
  stop(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export async function startAdapter(opts: {
  apiDir: string
  staticDir?: string
  env?: Record<string, string>
}): Promise<AdapterHandle> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    PORT: '0',
    HOST: '127.0.0.1',
    API_DIR: opts.apiDir,
    STATIC_DIR: opts.staticDir ?? resolve(REPO_ROOT, 'test/fixtures/cf-static-missing'),
    APP_ENV: 'test',
    ...opts.env,
  }

  const proc = spawn(process.execPath, ['server.mjs'], { cwd: REPO_ROOT, env })

  let output = ''
  proc.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  proc.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  const baseUrl = await new Promise<string>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new Error(`adapter did not start in time; output so far:\n${output}`))
    }, 10_000)
    const check = () => {
      const match = /listening on (http:\/\/127\.0\.0\.1:(\d+))/.exec(output)
      if (match) {
        clearTimeout(timer)
        resolvePromise(match[1])
        return
      }
      setTimeout(check, 25)
    }
    check()
    proc.once('exit', (code) => {
      clearTimeout(timer)
      rejectPromise(new Error(`adapter exited early with code ${code}; output:\n${output}`))
    })
  })

  return {
    baseUrl,
    proc,
    output: () => output,
    stop: () =>
      new Promise((resolvePromise) => {
        proc.once('exit', (code, signal) => resolvePromise({ code, signal }))
        proc.kill('SIGTERM')
      }),
  }
}
