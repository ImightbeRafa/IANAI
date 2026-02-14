import { Sparkles } from 'lucide-react'

interface GeneratingPlaceholderProps {
  aspectRatio?: '9/16' | '16/9' | '1/1'
  label?: string
  sublabel?: string
}

export default function GeneratingPlaceholder({
  aspectRatio = '9/16',
  label = 'Generando...',
  sublabel
}: GeneratingPlaceholderProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-dark-100 overflow-hidden">
      <div
        className="relative overflow-hidden"
        style={{ aspectRatio }}
      >
        {/* Animated gradient background */}
        <div className="absolute inset-0 gen-placeholder-bg" />

        {/* Sweeping light effect */}
        <div className="absolute inset-0 gen-placeholder-sweep" />

        {/* Subtle grid overlay */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)`,
            backgroundSize: '32px 32px'
          }}
        />

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          {/* Pulsing ring */}
          <div className="relative mb-4">
            <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center border border-white/20">
              <Sparkles className="w-7 h-7 text-white gen-placeholder-icon" />
            </div>
            <div className="absolute -inset-2 rounded-3xl border border-white/20 gen-placeholder-ring" />
            <div className="absolute -inset-4 rounded-[20px] border border-white/10 gen-placeholder-ring-outer" />
          </div>

          <p className="text-white/90 text-sm font-medium tracking-wide">{label}</p>
          {sublabel && (
            <p className="text-white/50 text-xs mt-1">{sublabel}</p>
          )}

          {/* Dot loader */}
          <div className="flex gap-1.5 mt-3">
            <div className="w-1.5 h-1.5 rounded-full bg-white/60 gen-dot-1" />
            <div className="w-1.5 h-1.5 rounded-full bg-white/60 gen-dot-2" />
            <div className="w-1.5 h-1.5 rounded-full bg-white/60 gen-dot-3" />
          </div>
        </div>
      </div>
    </div>
  )
}
