import { useState, useCallback, useRef, useEffect } from 'react'
import apiClient from '../api/client'

const STEPS = [
  'Geocoding location...',
  'Fetching market data...',
  'Searching for listings...',
  'Running financial analysis...',
  'Scoring properties...',
  'Done!',
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function criteriaKey(criteria: Record<string, any>): string {
  return JSON.stringify(criteria, Object.keys(criteria).sort())
}

export function usePropertySearch() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [results, setResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)

  // Cache lives in a ref — not shared across hook instances, no stale-closure risk
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cacheRef = useRef<{ key: string | null; data: any }>({ key: null, data: null })
  const stepRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Cleanup on unmount — clear interval and abort any in-flight request
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search = useCallback(async (criteria: Record<string, any>) => {
    const key = criteriaKey(criteria)

    if (cacheRef.current.key === key && cacheRef.current.data) {
      setResults(cacheRef.current.data)
      setStepIndex(STEPS.length - 1)
      setLoading(false)
      setError(null)
      return
    }

    // Cancel any previous in-flight request
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    setLoading(true)
    setError(null)
    setResults(null)
    stepRef.current = 0
    setStepIndex(0)

    // Advance the step indicator on a timer; tracked in a ref to avoid stale closure
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      stepRef.current = Math.min(stepRef.current + 1, STEPS.length - 2)
      setStepIndex(stepRef.current)
    }, 1800)

    try {
      const { data } = await apiClient.post('/search', criteria, {
        signal: abortRef.current.signal,
        timeout: 30_000,
      })
      if (intervalRef.current) clearInterval(intervalRef.current)
      setStepIndex(STEPS.length - 1)
      setResults(data)
      cacheRef.current = { key, data }
    } catch (err: unknown) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      const axiosErr = err as { code?: string; response?: { data?: { detail?: string } }; message?: string }
      // Ignore abort errors — they are expected when the component unmounts or retries
      if (axiosErr?.code === 'ERR_CANCELED') return
      const msg = axiosErr.response?.data?.detail || axiosErr.message || 'Search failed.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  const clearCache = useCallback(() => {
    cacheRef.current = { key: null, data: null }
  }, [])

  const retry = useCallback((criteria: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    cacheRef.current = { key: null, data: null }
    search(criteria)
  }, [search])

  return { results, loading, error, search, clearCache, retry, steps: STEPS, stepIndex }
}

// NOTE: `useLocationAutocomplete` (Nominatim-backed) was removed in favor of
// `usePhotonAutocomplete` (photon.komoot.io — no API key required) for
// sub-100ms realtime suggestions. The backend `/api/autocomplete` endpoint
// is retained as a non-preferred fallback.
