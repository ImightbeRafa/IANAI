/**
 * Background work (#14) for door tests: packs advance in self-continuing background slices, never
 * inline in a status read. Tests queue the scheduled work and run it explicitly ("time passes").
 */
import { resetPackLoops } from '../../api/lib/adpack/background'
import { setMcpExecuteScheduler } from '../../api/lib/mcp/execute-job'

type WebSetter = (fn: ((work: () => Promise<unknown>) => void) | null) => void

const queue: Array<() => Promise<unknown>> = []
let webSetter: WebSetter | null = null

/** Route MCP (and, with `web`, the web door's) background work into a queue — call in beforeEach. */
export function queueBackgroundWork(web?: WebSetter): void {
  queue.length = 0
  resetPackLoops()
  webSetter = web ?? null
  webSetter?.((work) => {
    queue.push(work)
  })
  setMcpExecuteScheduler((work) => {
    queue.push(work)
  })
}

/** Scheduled background jobs not run yet. */
export function pendingBackground(): number {
  return queue.length
}

/** Run queued work (and the slices it schedules) until the queue is empty. Returns jobs run. */
export async function drainBackground(max = 500): Promise<number> {
  let ran = 0
  while (queue.length && ran < max) {
    const work = queue.shift()!
    await work()
    ran++
  }
  return ran
}

/** Drop queued work without running it (a host that killed the background task). */
export function dropBackground(): number {
  const n = queue.length
  queue.length = 0
  return n
}

/** Restore default schedulers — call in afterEach. */
export function restoreBackgroundWork(): void {
  queue.length = 0
  resetPackLoops()
  webSetter?.(null)
  webSetter = null
  setMcpExecuteScheduler((work) => {
    void work().catch(() => {})
  })
}
