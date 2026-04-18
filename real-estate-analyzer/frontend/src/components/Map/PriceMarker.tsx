import { Marker } from 'react-map-gl/maplibre'
import { formatCurrency } from '../../utils/formatters'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface PriceMarkerProps {
  listing: any
  score: any
  isHovered: boolean
  isSelected: boolean
  onClick: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export default function PriceMarker({
  listing,
  score,
  isHovered,
  isSelected,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: PriceMarkerProps) {
  const s: number = score?.overall_score ?? 0
  const active = isHovered || isSelected

  let glowColor = 'rgba(100, 116, 139, 0.4)'
  let borderColor = 'border-slate-500/40'
  if (s >= 75) {
    glowColor = 'rgba(52, 211, 153, 0.5)'
    borderColor = 'border-emerald-400/60'
  } else if (s >= 60) {
    glowColor = 'rgba(96, 165, 250, 0.5)'
    borderColor = 'border-blue-400/60'
  } else if (s >= 45) {
    glowColor = 'rgba(251, 191, 36, 0.5)'
    borderColor = 'border-amber-400/60'
  }

  const priceLabel = formatCurrency(listing.list_price, { compact: true })

  return (
    <Marker
      longitude={listing.lng}
      latitude={listing.lat}
      anchor="bottom"
    >
      <div
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={`
          cursor-pointer select-none transition-all duration-200 ease-out
          ${active ? 'scale-125 z-50' : 'scale-100 z-10'}
        `}
        style={active ? { filter: `drop-shadow(0 0 8px ${glowColor})` } : undefined}
      >
        <div
          className={`
            relative px-2.5 py-1 rounded-lg border backdrop-blur-md
            bg-slate-900/80 text-white text-xs font-bold whitespace-nowrap
            ${borderColor}
            ${active ? 'ring-1 ring-white/30' : ''}
          `}
        >
          {priceLabel}
          <span
            className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-slate-900/80 ${
              s >= 75 ? 'bg-emerald-400' : s >= 60 ? 'bg-blue-400' : s >= 45 ? 'bg-amber-400' : 'bg-slate-400'
            }`}
          />
        </div>
        <div className="flex justify-center -mt-[1px]">
          <div className="w-2 h-2 bg-slate-900/80 rotate-45 border-b border-r border-slate-500/40" />
        </div>
      </div>
    </Marker>
  )
}
