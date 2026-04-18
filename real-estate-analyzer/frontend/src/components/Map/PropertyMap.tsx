import { useRef, useEffect, useMemo, useCallback } from 'react'
import Map, { MapRef } from 'react-map-gl/maplibre'
import type { LngLatBoundsLike } from 'maplibre-gl'
import PriceMarker from './PriceMarker'
import 'maplibre-gl/dist/maplibre-gl.css'

/* eslint-disable @typescript-eslint/no-explicit-any */

// OpenFreeMap — free, no account or API key required (https://openfreemap.org)
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const FIT_BOUNDS_OPTS = { padding: 80, maxZoom: 15, duration: 800 }

/** Compute [minLng, minLat, maxLng, maxLat] from a list of properties. */
function computeBounds(properties: any[]): LngLatBoundsLike | null {
  if (!properties?.length) return null
  let minLng = Infinity, maxLng = -Infinity
  let minLat = Infinity, maxLat = -Infinity
  for (const r of properties) {
    const { lat, lng } = r.listing
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return [minLng, minLat, maxLng, maxLat]
}


interface PropertyMapProps {
  properties: any[]
  hoveredPropertyId: string | null
  selectedPropertyId: string | null
  onHoverProperty: (id: string | null) => void
  onSelectProperty: (id: string) => void
  className?: string
}

export default function PropertyMap({
  properties,
  hoveredPropertyId,
  selectedPropertyId,
  onHoverProperty,
  onSelectProperty,
  className = '',
}: PropertyMapProps) {
  const mapRef = useRef<MapRef>(null)


  // Initial viewport — MapLibre handles the math correctly via bounds
  const bounds = useMemo(() => computeBounds(properties), [properties])
  const initialViewState = useMemo(() => {
    if (!bounds) return { longitude: -98.5, latitude: 39.8, zoom: 4 }
    return { bounds: bounds as LngLatBoundsLike, fitBoundsOptions: FIT_BOUNDS_OPTS }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps — intentionally only on mount

  // Re-fit whenever the property list changes (e.g. after search results load)
  useEffect(() => {
    if (!bounds || !mapRef.current) return
    mapRef.current.fitBounds(bounds as LngLatBoundsLike, FIT_BOUNDS_OPTS)
  }, [bounds])

  const handleMarkerClick = useCallback((id: string) => {
    onSelectProperty?.(id)
  }, [onSelectProperty])

  return (
    <div className={`overflow-hidden border border-border ${className}`}>
      <Map
        ref={mapRef}
        initialViewState={initialViewState}
        mapStyle={MAP_STYLE}
        style={{ width: '100%', height: '100%' }}
        reuseMaps
        attributionControl={false}
      >
        {properties.map((result: any) => (
          <PriceMarker
            key={result.listing.id}
            listing={result.listing}
            score={result.score}
            isHovered={result.listing.id === hoveredPropertyId}
            isSelected={result.listing.id === selectedPropertyId}
            onClick={() => handleMarkerClick(result.listing.id)}
            onMouseEnter={() => onHoverProperty?.(result.listing.id)}
            onMouseLeave={() => onHoverProperty?.(null)}
          />
        ))}
      </Map>
    </div>
  )
}
