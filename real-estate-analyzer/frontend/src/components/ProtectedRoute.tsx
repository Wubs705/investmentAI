import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

interface ProtectedRouteProps {
  children: ReactNode
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, setShowAuthModal } = useAuth()
  const location = useLocation()

  // Auth not configured — open mode, allow all
  if (!supabase) return <>{children}</>

  if (loading) return null

  if (!user) {
    setShowAuthModal(true)
    return <Navigate to="/" state={{ from: location }} replace />
  }

  return <>{children}</>
}
