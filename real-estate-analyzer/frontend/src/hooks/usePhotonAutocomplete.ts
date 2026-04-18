import { useCallback, useRef, useState } from 'react'

/**
 * Photon (komoot) autocomplete — zero-config, no API key, no sign-up.
 *
 * Uses https://photon.komoot.io (OpenStreetMap-backed) for real-time
 * location typeahead. Unlike Mapbox, Photon returns coordinates directly
 * in each suggestion — there is no separate "retrieve" round-trip.
 * The ResolvedLocation is available the moment a suggestion is rendered.
 *
 * Stale-response safety: AbortController + monotonic sequence counter
 * ensure that only the result from the most recent keystroke is applied.
 */

const PHOTON_URL = 'https://photon.komoot.io/api/'

const US_STATE_CODES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR',
  California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
  Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS',
  Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS',
  Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK',
  Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
}

/** Normalized location passed to the backend as location_hint. */
export interface ResolvedLocation {
  city: string
  state: string
  state_code: string
  zip_code: string | null
  county: string | null
  lat: number
  lng: number
  display_name: string
}

/**
 * A single Photon autocomplete suggestion.
 * The `location` field is already resolved — no second network call needed.
 */
export interface PhotonSuggestion {
  /** Stable React list key: osm_type + osm_id */
  id: string
  /** Primary display text, e.g. "Austin" */
  name: string
  /** Secondary context line, e.g. "TX, US" */
  place_formatted: string
  /** Photon osm_value, e.g. "city", "town", "village" */
  feature_type: string
  /** Text placed into the search input on selection, e.g. "Austin, TX" */
  full_text: string
  /** Fully-resolved location — free, no round-trip */
  location: ResolvedLocation
}

interface RawFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    osm_id?: number
    osm_type?: string
    name?: string
    type?: string
    osm_value?: string
    state?: string
    country?: string
    countrycode?: string
    city?: string
    county?: string
    postcode?: string
    [key: string]: unknown
  }
}

const CITY_TIER_TYPES = new Set([
  'city', 'town', 'village', 'municipality', 'borough', 'hamlet',
])

/**
 * Parse a GeoJSON feature from Photon into a PhotonSuggestion.
 * Returns null for anything the backend can't usefully search — ensures
 * every suggestion we render carries a real city + 2-letter state code.
 */
function parseFeature(f: RawFeature): PhotonSuggestion | null {
  const p = f.properties
  const [lng, lat] = f.geometry.coordinates
  if (typeof lat !== 'number' || typeof lng !== 'number') return null

  // --- US filter -----------------------------------------------------------
  // Photon's `country` field varies ("United States", "United States of America",
  // sometimes missing). Use the state-name lookup as the primary signal and
  // reject only when country is *explicitly* non-US.
  const state = (p.state ?? '') as string
  const stateCode = Object.prototype.hasOwnProperty.call(US_STATE_CODES, state)
    ? US_STATE_CODES[state]
    : ''
  if (!stateCode) return null  // Rentcast needs a real 2-letter code

  const country = (p.country ?? '') as string
  if (
    country &&
    country !== 'United States' &&
    country !== 'United States of America' &&
    p.countrycode !== 'US'
  ) {
    return null
  }

  // --- Feature-type filter -------------------------------------------------
  // Drop state/country-only matches — they'd pass "Texas" as a city.
  const featureType = (p.type ?? p.osm_value ?? '') as string
  if (featureType === 'state' || featureType === 'country') return null

  // --- City extraction -----------------------------------------------------
  // For city-tier features the name IS the city. For sub-types (postcode,
  // suburb, neighbourhood, locality) the parent city lives in p.city.
  const name = (p.name ?? '') as string
  const city = CITY_TIER_TYPES.has(featureType)
    ? name
    : ((p.city as string | undefined) ?? '')
  if (!city) return null  // can't search without a city name

  // --- Build suggestion ----------------------------------------------------
  const id = `${p.osm_type ?? 'N'}${p.osm_id ?? `${lat},${lng}`}`
  const postcode = (p.postcode ?? null) as string | null
  const county = (p.county ?? null) as string | null

  // Secondary line shows city for non-city features so a zip like "78701"
  // reads as "Austin, TX" instead of just "TX, US".
  const place_formatted = CITY_TIER_TYPES.has(featureType)
    ? `${stateCode}, US`
    : `${city}, ${stateCode}`

  // Full text in the input — keep the recognizable query (e.g. zip) plus state
  const full_text = CITY_TIER_TYPES.has(featureType)
    ? `${name}, ${stateCode}`
    : `${name} — ${city}, ${stateCode}`

  const location: ResolvedLocation = {
    city,
    state,
    state_code: stateCode,
    zip_code: postcode,
    county,
    lat,
    lng,
    display_name: full_text,
  }

  return { id, name, place_formatted, feature_type: featureType, full_text, location }
}

export function usePhotonAutocomplete() {
  const [suggestions, setSuggestions] = useState<PhotonSuggestion[]>([])
  const [fetching, setFetching] = useState(false)

  const controllerRef = useRef<AbortController | null>(null)
  const seqRef = useRef(0)

  const fetchSuggestions = useCallback(async (query: string) => {
    // Abort any in-flight request before starting a new one
    if (controllerRef.current) controllerRef.current.abort()

    const q = query.trim()
    if (!q || q.length < 2) {
      setSuggestions([])
      return
    }

    const seq = ++seqRef.current
    const controller = new AbortController()
    controllerRef.current = controller

    const params = new URLSearchParams({
      q,
      limit: '10',  // fetch a few extra; non-US ones get filtered out
      lang: 'en',
      // Bias results toward the continental US center without hard-restricting
      lat: '39.5',
      lon: '-98.5',
    })

    setFetching(true)
    try {
      const resp = await fetch(`${PHOTON_URL}?${params.toString()}`, {
        signal: controller.signal,
      })
      if (!resp.ok) {
        if (seq === seqRef.current) setSuggestions([])
        return
      }
      const data = await resp.json()
      if (seq !== seqRef.current) return // stale response — discard

      const features = (data.features ?? []) as RawFeature[]
      const parsed = features
        .map(parseFeature)
        .filter((s): s is PhotonSuggestion => s !== null)
        .slice(0, 8)

      if (seq !== seqRef.current) return
      setSuggestions(parsed)
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') return
      if (seq === seqRef.current) setSuggestions([])
    } finally {
      if (seq === seqRef.current) setFetching(false)
    }
  }, [])

  const clear = useCallback(() => setSuggestions([]), [])

  return { suggestions, fetching, fetchSuggestions, clear }
}
