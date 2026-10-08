/**
 * Ad Pack engine — adapter from the runner's `Renderer` to `./render` (built in
 * parallel; wired after merge).
 *
 * TODO(adpack-render-merge): once `api/lib/adpack/render/index.ts` lands, replace
 * the untyped dynamic import with a static `import { renderAd } from './render/index.js'`.
 * Until then the specifier is typed `as string` so `tsc` does not resolve it.
 */
import type { Renderer, RenderInput, RenderOutput } from './runner-types.js'

type RenderAdFn = (input: {
  format: RenderInput['format']
  ratio: RenderInput['ratio']
  sceneImage: Buffer | string
  copy: RenderInput['copy']
  visual: RenderInput['visual']
  productCutout?: Buffer | string
  language: RenderInput['language']
}) => Promise<{ png: Buffer | Uint8Array; width: number; height: number; layoutReport?: unknown }>

function toBufferOrString(v: Uint8Array | string | undefined): Buffer | string | undefined {
  if (v === undefined || typeof v === 'string') return v
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

export function createDefaultRenderer(): Renderer {
  let renderAd: RenderAdFn | null = null
  async function load(): Promise<RenderAdFn> {
    if (renderAd) return renderAd
    const specifier = './render/index.js' as string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ specifier)
    if (typeof mod?.renderAd !== 'function') throw new Error('adpack_render_module_missing: ./render/index has no renderAd export')
    renderAd = mod.renderAd as RenderAdFn
    return renderAd
  }
  return {
    async render(input: RenderInput): Promise<RenderOutput> {
      const fn = await load()
      const out = await fn({
        format: input.format,
        ratio: input.ratio,
        sceneImage: toBufferOrString(input.sceneImage)!,
        copy: input.copy,
        visual: input.visual,
        productCutout: toBufferOrString(input.productCutout),
        language: input.language,
      })
      return { png: new Uint8Array(out.png), width: out.width, height: out.height }
    },
  }
}
