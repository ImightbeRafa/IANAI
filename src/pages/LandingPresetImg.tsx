import { landingPresetThumb } from './landingPresetMedia'

interface LandingPresetImgProps {
  src: string
  alt: string
  className?: string
  sizes: string
  loading?: 'lazy' | 'eager'
}

export default function LandingPresetImg({
  src,
  alt,
  className,
  sizes,
  loading = 'lazy',
}: LandingPresetImgProps) {
  const media = landingPresetThumb(src)
  return (
    <img
      src={media.src}
      srcSet={media.srcSet}
      sizes={sizes}
      alt={alt}
      className={className}
      loading={loading}
      decoding="async"
    />
  )
}
