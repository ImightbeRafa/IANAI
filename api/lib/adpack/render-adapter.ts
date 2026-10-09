/**
 * Ad Pack engine — adapter from the runner's `Renderer` to `./render`.
 * Static import so Vercel's tracer and the Cloudflare esbuild step bundle it.
 */
import { renderAd, type FetchLike } from './render/index.js'
import type { Renderer, RenderInput, RenderOutput } from './runner-types.js'

function toBufferOrString(v: Uint8Array | string | undefined): Buffer | string | undefined {
  if (v === undefined || typeof v === 'string') return v
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

export function createDefaultRenderer(): Renderer {
  return {
    async render(input: RenderInput): Promise<RenderOutput> {
      const out = await renderAd({
        format: input.format,
        ratio: input.ratio,
        sceneImage: toBufferOrString(input.sceneImage)!,
        copy: input.copy,
        visual: input.visual,
        productCutout: toBufferOrString(input.productCutout),
        language: input.language,
        layoutFamily: input.layoutFamily,
        productBox: input.productBox,
        // Brand fonts: bundled → disk cache → Google Fonts (ADPACK_FONT_FETCH=0 disables network).
        fonts: { fetch: fontFetchEnabled() ? (globalThis.fetch as unknown as FetchLike) : null },
      })
      return { png: new Uint8Array(out.png), width: out.width, height: out.height }
    },
  }
}

function fontFetchEnabled(): boolean {
  return process.env.ADPACK_FONT_FETCH !== '0' && typeof globalThis.fetch === 'function'
}
