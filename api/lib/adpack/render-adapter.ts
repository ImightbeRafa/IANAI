/**
 * Ad Pack engine — adapter from the runner's `Renderer` to `./render`.
 * Static import so Vercel's tracer and the Cloudflare esbuild step bundle it.
 */
import { renderAd } from './render/index.js'
import type { Renderer, RenderInput, RenderOutput } from './runner-types.js'

function toBufferOrString(v: Uint8Array | string | undefined): Buffer | string | undefined {
  if (v === undefined || typeof v === 'string') return v
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

const u8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength)

export function createDefaultRenderer(): Renderer {
  return {
    async render(input: RenderInput): Promise<RenderOutput> {
      const relight = input.relight
      const out = await renderAd({
        format: input.format,
        ratio: input.ratio,
        sceneImage: toBufferOrString(input.sceneImage)!,
        copy: input.copy,
        visual: input.visual,
        productCutout: toBufferOrString(input.productCutout),
        language: input.language,
        ...(input.logo ? { logo: toBufferOrString(input.logo) } : {}),
        ...(input.productMode ? { productMode: input.productMode } : {}),
        ...(input.productParts?.length ? { productParts: input.productParts.map((p) => toBufferOrString(p)!) } : {}),
        ...(input.light ? { light: input.light } : {}),
        ...(input.productAvoid ? { productAvoid: input.productAvoid } : {}),
        ...(relight
          ? {
              relight: (composite, placements, ratio) =>
                relight(u8(composite), placements.map((p) => ({ box: p.box, placed: u8(p.placed), role: p.role })), ratio),
            }
          : {}),
      })
      return {
        png: new Uint8Array(out.png),
        width: out.width,
        height: out.height,
        ...(out.productPlacements?.length ? { productPlacements: out.productPlacements.map((p) => ({ box: p.box, placed: u8(p.placed), role: p.role })) } : {}),
        ...(out.relit ? { relit: true } : {}),
        ...(out.layoutReport.textOverProduct ? { textOverProduct: true } : {}),
      }
    },
  }
}
