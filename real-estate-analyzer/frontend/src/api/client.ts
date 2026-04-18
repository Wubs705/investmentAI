import axios, { type InternalAxiosRequestConfig } from 'axios'
import { supabase } from '../lib/supabase'

const apiClient = axios.create({
  baseURL: '/api',
})

const apiKey = import.meta.env.VITE_API_KEY as string | undefined
if (apiKey) {
  apiClient.defaults.headers.common['X-API-Key'] = apiKey
}

let _testMode = false

export function setTestMode(enabled: boolean): void {
  _testMode = enabled
}

export function getTestMode(): boolean {
  return _testMode
}

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  // Attach Supabase Bearer token when a session exists
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      config.headers['Authorization'] = `Bearer ${session.access_token}`
    }
  }
  if (_testMode) {
    config.headers['X-Test-Mode'] = 'true'
  }
  return config
})

export default apiClient
