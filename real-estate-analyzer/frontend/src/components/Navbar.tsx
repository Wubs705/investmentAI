import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const NAV_LINKS = [
  { to: '/', label: 'Search' },
  { to: '/market', label: 'Market Data' },
  { to: '/how-it-works', label: 'How It Works' },
]

interface NavbarProps {
  compact?: boolean
  searchSummary?: string
}

export default function Navbar({ compact, searchSummary }: NavbarProps) {
  const { pathname } = useLocation()
  const { user, signOut, setShowAuthModal } = useAuth()

  return (
    <nav className="zillow-nav sticky top-0 z-30">
      <div className="max-w-[1440px] mx-auto px-6 flex items-center justify-between h-14">
        {/* Left links */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              to={link.to}
              className={`text-sm font-medium transition-colors whitespace-nowrap ${
                pathname === link.to ? 'text-primary' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Center logo */}
        <Link
          to="/"
          className="absolute left-1/2 -translate-x-1/2 text-xl font-bold text-primary flex-shrink-0"
        >
          InvestmentAI
        </Link>

        {/* Right — auth state */}
        <div className="flex items-center gap-4 ml-auto">
          {compact && searchSummary && (
            <span className="hidden lg:block text-sm text-text-muted truncate max-w-xs">
              {searchSummary}
            </span>
          )}

          {supabase && user ? (
            <div className="flex items-center gap-3">
              <span className="hidden sm:block text-sm text-gray-500 truncate max-w-[140px]">
                {user.email}
              </span>
              <button
                onClick={() => signOut()}
                className="text-sm font-semibold bg-gray-100 text-gray-700 px-4 py-1.5 rounded-full hover:bg-gray-200 transition-colors"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              className="text-sm font-semibold bg-text-primary text-white px-4 py-1.5 rounded-full hover:bg-text-primary/90 transition-colors"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}
