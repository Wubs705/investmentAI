/**
 * @deprecated Replaced by usePhotonAutocomplete (no API key required).
 * This file is kept only to avoid hard build errors if any import was missed.
 * Remove once you confirm nothing imports from here.
 */
export {
  usePhotonAutocomplete as useMapboxAutocomplete,
  type PhotonSuggestion as MapboxSuggestion,
  type ResolvedLocation,
} from './usePhotonAutocomplete'
