// Cloudflare Worker entry point (Betsy pattern). Not part of the SPA; excluded
// from the root tsconfig; checked by `tsconfig.cf-worker.json`.
import { Container, getContainer } from '@cloudflare/containers'
import { env } from 'cloudflare:workers'
import { getContainerEnvVars } from '../cf/container-env.mjs'
import { handleFetch, handleScheduled, type WorkerEnv } from '../cf/worker-core'

interface Env extends WorkerEnv {
  ADVANCE_AI_CONTAINER: DurableObjectNamespace<AdvanceAiContainer>
}

export class AdvanceAiContainer extends Container {
  defaultPort = 8080
  sleepAfter = '30m'
  envVars = getContainerEnvVars(env as unknown as Record<string, unknown>)
}

const containerFetch = (req: Request, e: WorkerEnv) => getContainer((e as Env).ADVANCE_AI_CONTAINER).fetch(req)

export default {
  fetch: (request: Request, e: Env) => handleFetch(request, e, containerFetch),
  async scheduled(controller: ScheduledController, e: Env, _ctx: ExecutionContext) {
    await handleScheduled(controller, e, containerFetch)
  },
}
