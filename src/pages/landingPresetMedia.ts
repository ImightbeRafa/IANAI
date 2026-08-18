const THUMB_WIDTHS = [360, 720] as const

export function landingPresetThumbSlug(pngPath: string): string {
  return pngPath.replace(/^\/presets\//, '').replace(/\.png$/i, '').replace(/\//g, '__')
}

export function landingPresetThumbSrc(pngPath: string, width: (typeof THUMB_WIDTHS)[number] = 360): string {
  return `/presets/thumbs/${landingPresetThumbSlug(pngPath)}-${width}w.webp`
}

export function landingPresetThumb(pngPath: string): { src: string; srcSet: string } {
  const src = landingPresetThumbSrc(pngPath, 360)
  const srcSet = THUMB_WIDTHS
    .map((width) => `${landingPresetThumbSrc(pngPath, width)} ${width}w`)
    .join(', ')
  return { src, srcSet }
}
