import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Trash2, Loader2, Leaf } from 'lucide-react'

export interface CarouselSlide {
  id: string
  imageUrl: string
  slideIndex: number
  slideTotal: number
  prompt: string
}

interface Props {
  groupId: string
  subtype: string | null
  slides: CarouselSlide[]
  /** Download the currently-visible slide. */
  onDownloadSlide: (slide: CarouselSlide) => void
  /** Download ALL slides as individual files. */
  onDownloadAll: (slides: CarouselSlide[]) => void
  /** Delete the entire carousel (all slides). */
  onDeleteCarousel: (slides: CarouselSlide[]) => void
  /** UI feedback: true while delete is in flight for any slide in the carousel. */
  deleting?: boolean
  language: 'en' | 'es'
}

const SUBTYPE_LABELS: Record<string, { es: string; en: string }> = {
  'educational-list': { es: 'Lista Educativa', en: 'Educational List' },
  'how-to-steps': { es: 'How-To / Pasos', en: 'How-To / Steps' },
  'before-after': { es: 'Antes / Después', en: 'Before / After' },
  'myth-vs-fact': { es: 'Mito vs Realidad', en: 'Myth vs Fact' },
}

export default function CarouselGroupCard({
  groupId, subtype, slides, onDownloadSlide, onDownloadAll, onDeleteCarousel, deleting, language,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Slides come in index order (1..N). Guard against missing indices.
  const sortedSlides = [...slides].sort((a, b) => a.slideIndex - b.slideIndex)
  const activeSlide = sortedSlides[activeIndex] ?? sortedSlides[0]
  const total = activeSlide?.slideTotal ?? sortedSlides.length

  const subtypeLabel = subtype && SUBTYPE_LABELS[subtype]
    ? (language === 'es' ? SUBTYPE_LABELS[subtype].es : SUBTYPE_LABELS[subtype].en)
    : (language === 'es' ? 'Carrusel' : 'Carousel')

  const goPrev = () => setActiveIndex(i => (i > 0 ? i - 1 : sortedSlides.length - 1))
  const goNext = () => setActiveIndex(i => (i < sortedSlides.length - 1 ? i + 1 : 0))

  if (!activeSlide) return null

  return (
    <div
      data-carousel-group-id={groupId}
      className="bg-dark-100 rounded-xl shadow-sm overflow-hidden group border border-emerald-900/30 card-hover transition-all animate-entrance"
    >
      {/* Main image viewer */}
      <div className="relative overflow-hidden bg-dark-200">
        <img
          src={activeSlide.imageUrl}
          alt={`Carousel slide ${activeSlide.slideIndex} of ${total}`}
          className="w-full h-auto transition-opacity duration-200"
        />

        {/* Subtype + carousel badge (top-left) */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-900/70 backdrop-blur-sm border border-emerald-700/40 text-emerald-200 text-[10px] font-semibold uppercase tracking-wider">
            <Leaf className="w-3 h-3" />
            {subtypeLabel}
          </div>
        </div>

        {/* Slide counter (top-right) */}
        <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm text-white text-xs font-semibold tabular-nums">
          {activeSlide.slideIndex} / {total}
        </div>

        {/* Navigation arrows — only shown on hover for cleanliness */}
        {sortedSlides.length > 1 && (
          <>
            <button
              onClick={goPrev}
              className="absolute top-1/2 -translate-y-1/2 left-3 w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 hover:bg-black/80 transition-all flex items-center justify-center"
              aria-label={language === 'es' ? 'Slide anterior' : 'Previous slide'}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={goNext}
              className="absolute top-1/2 -translate-y-1/2 right-3 w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 hover:bg-black/80 transition-all flex items-center justify-center"
              aria-label={language === 'es' ? 'Siguiente slide' : 'Next slide'}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Dot pager */}
        {sortedSlides.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/50 backdrop-blur-sm">
            {sortedSlides.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveIndex(i)}
                className={`transition-all rounded-full ${
                  i === activeIndex
                    ? 'w-5 h-1.5 bg-white'
                    : 'w-1.5 h-1.5 bg-white/50 hover:bg-white/75'
                }`}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Thumbnail strip (scrolls if many slides) */}
      {sortedSlides.length > 1 && (
        <div className="px-3 py-2 border-t border-dark-200/50 bg-dark-50/50 overflow-x-auto">
          <div className="flex items-center gap-1.5">
            {sortedSlides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setActiveIndex(i)}
                className={`relative flex-shrink-0 w-11 h-11 rounded-md overflow-hidden border-2 transition-all ${
                  i === activeIndex
                    ? 'border-emerald-500 scale-105 shadow-md shadow-emerald-900/40'
                    : 'border-transparent opacity-60 hover:opacity-100'
                }`}
                aria-label={`Slide ${s.slideIndex}`}
              >
                <img src={s.imageUrl} alt="" className="w-full h-full object-cover" />
                <div className="absolute bottom-0 right-0 px-1 text-[8px] font-bold text-white bg-black/60 leading-tight">
                  {s.slideIndex}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="p-3 space-y-2 border-t border-dark-200/50">
        <div className="flex gap-2">
          <button
            onClick={() => onDownloadSlide(activeSlide)}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dark-200 text-dark-600 text-xs font-medium hover:bg-dark-50 transition-colors"
            title={language === 'es' ? 'Descargar slide visible' : 'Download visible slide'}
          >
            <Download className="w-3.5 h-3.5" />
            {language === 'es' ? 'Slide' : 'Slide'} {activeSlide.slideIndex}
          </button>
          <button
            onClick={() => onDownloadAll(sortedSlides)}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-900/20 border border-emerald-800/40 text-emerald-300 text-xs font-medium hover:bg-emerald-900/30 transition-colors"
            title={language === 'es' ? `Descargar los ${sortedSlides.length} slides` : `Download all ${sortedSlides.length} slides`}
          >
            <Download className="w-3.5 h-3.5" />
            {language === 'es' ? `Todos (${sortedSlides.length})` : `All (${sortedSlides.length})`}
          </button>
        </div>

        {/* Delete with confirm */}
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="flex-1 px-3 py-2 rounded-lg bg-dark-200 text-dark-600 text-xs font-medium hover:bg-dark-300 transition-colors disabled:opacity-50"
            >
              {language === 'es' ? 'Cancelar' : 'Cancel'}
            </button>
            <button
              onClick={() => onDeleteCarousel(sortedSlides)}
              disabled={deleting}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/40 text-red-300 text-xs font-medium hover:bg-red-900/40 transition-colors disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              {language === 'es' ? `Eliminar ${sortedSlides.length} slides` : `Delete ${sortedSlides.length} slides`}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-red-400 text-xs font-medium hover:bg-red-900/15 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {language === 'es' ? 'Eliminar carrusel' : 'Delete carousel'}
          </button>
        )}
      </div>
    </div>
  )
}
