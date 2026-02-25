import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { getBrandKits } from '../services/database'
import type { BrandKit } from '../types'
import { Palette, ChevronDown, Star, X } from 'lucide-react'

interface BrandKitSelectorProps {
  selectedKitId: string | null
  onSelect: (kitId: string | null) => void
  productId?: string
  compact?: boolean
}

export default function BrandKitSelector({ selectedKitId, onSelect, productId, compact }: BrandKitSelectorProps) {
  const { user } = useAuth()
  const { language } = useLanguage()
  const [kits, setKits] = useState<BrandKit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      if (!user) return
      try {
        const data = await getBrandKits(user.id)
        setKits(data.filter(k => k.is_active))
      } catch {
        setKits([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user])

  // Restore last-used kit from localStorage
  useEffect(() => {
    if (!loading && kits.length > 0 && selectedKitId === null && productId) {
      const stored = localStorage.getItem(`bk_${productId}`)
      if (stored && kits.some(k => k.id === stored)) {
        onSelect(stored)
      } else {
        // Auto-select default kit
        const defaultKit = kits.find(k => k.is_default)
        if (defaultKit) {
          onSelect(defaultKit.id)
        }
      }
    }
  }, [loading, kits, productId])

  // Persist selection
  useEffect(() => {
    if (productId && selectedKitId) {
      localStorage.setItem(`bk_${productId}`, selectedKitId)
    }
  }, [selectedKitId, productId])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (loading || kits.length === 0) return null

  const selectedKit = kits.find(k => k.id === selectedKitId)

  const labels = {
    es: {
      none: 'Sin Brand Kit',
      placeholder: 'Brand Kit',
      default: 'predeterminado'
    },
    en: {
      none: 'No Brand Kit',
      placeholder: 'Brand Kit',
      default: 'default'
    }
  }
  const t = labels[language]

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-xs font-medium ${
          selectedKit
            ? 'border-primary-300 bg-primary-900/10 text-primary-400 hover:bg-primary-900/20'
            : 'border-dark-200 bg-dark-50 text-dark-500 hover:border-dark-300'
        } ${compact ? 'px-2 py-1' : ''}`}
      >
        {selectedKit ? (
          <>
            <div
              className="w-3 h-3 rounded-full border border-dark-200 flex-shrink-0"
              style={{ backgroundColor: selectedKit.primary_color || '#6366f1' }}
            />
            <span className="max-w-[100px] truncate">{selectedKit.name}</span>
          </>
        ) : (
          <>
            <Palette className="w-3.5 h-3.5" />
            <span>{t.placeholder}</span>
          </>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl shadow-lg border border-dark-200 z-50 py-1 max-h-64 overflow-y-auto">
          {/* None option */}
          <button
            onClick={() => {
              onSelect(null)
              if (productId) localStorage.removeItem(`bk_${productId}`)
              setOpen(false)
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-dark-50 transition-colors ${
              !selectedKitId ? 'text-primary-500 font-medium' : 'text-dark-500'
            }`}
          >
            <X className="w-3.5 h-3.5 text-dark-400" />
            {t.none}
          </button>

          <div className="border-t border-dark-100 my-1" />

          {/* Kit options */}
          {kits.map(kit => (
            <button
              key={kit.id}
              onClick={() => {
                onSelect(kit.id)
                setOpen(false)
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-dark-50 transition-colors ${
                selectedKitId === kit.id ? 'text-primary-500 font-medium bg-primary-900/5' : 'text-dark-700'
              }`}
            >
              {/* Color swatches */}
              <div className="flex -space-x-1 flex-shrink-0">
                {[kit.primary_color, kit.secondary_color, kit.accent_color]
                  .filter(Boolean)
                  .slice(0, 3)
                  .map((color, i) => (
                    <div
                      key={i}
                      className="w-3.5 h-3.5 rounded-full border border-white"
                      style={{ backgroundColor: color || '#ccc' }}
                    />
                  ))}
              </div>

              <span className="flex-1 text-left truncate">{kit.name}</span>

              {kit.is_default && (
                <Star className="w-3 h-3 text-amber-500 fill-amber-500 flex-shrink-0" />
              )}

              {kit.logo_url && (
                <img
                  src={kit.logo_url}
                  alt=""
                  className="w-4 h-4 rounded object-cover flex-shrink-0"
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
