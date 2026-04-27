import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

const NAV_LINKS = [
  { to: '/market',       label: 'Markets' },
  { to: '/how-it-works', label: 'How it works' },
]

interface NavbarProps {
  compact?: boolean
  searchSummary?: string
}

export default function Navbar({ compact, searchSummary }: NavbarProps) {
  const { pathname } = useLocation()
  const { user, signOut, setShowAuthModal } = useAuth()

  return (
    <nav style={{ background: 'var(--paper)', borderBottom: '1px solid var(--rule-soft)', position: 'sticky', top: 0, zIndex: 30 }}>
      <div className="max-w-[1440px] mx-auto px-8 flex items-center justify-between h-14">
        {/* Logo */}
        <Link to="/" className="flex items-baseline gap-2" style={{ textDecoration: 'none' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4 11 L12 4 L20 11 L20 20 L14 20 L14 14 L10 14 L10 20 L4 20 Z" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round"/>
            <circle cx="12" cy="4" r="1.2" fill="var(--accent)"/>
          </svg>
          <span className="font-serif tracking-display" style={{ fontSize: 18, color: 'var(--ink)', letterSpacing: '0.02em' }}>Cornice</span>
        </Link>

        {/* Center — search summary (compact mode) or nav links */}
        <div className="hidden md:flex items-center gap-6">
          {compact && searchSummary ? (
            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, color: 'var(--ink-3)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {searchSummary}
            </span>
          ) : (
            NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: pathname === link.to ? 'var(--ink)' : 'var(--ink-3)',
                  textDecoration: 'none',
                  transition: 'color .15s',
                  whiteSpace: 'nowrap',
                }}
              >
                {link.label}
              </Link>
            ))
          )}
        </div>

        {/* Right — auth */}
        <div className="flex items-center gap-3">
          {supabase && user ? (
            <div className="flex items-center gap-3">
              <span className="hidden sm:block" style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </span>
              <button
                onClick={() => signOut()}
                style={{ fontSize: 13, fontWeight: 500, background: 'var(--paper-2)', color: 'var(--ink-2)', border: '1px solid var(--rule)', borderRadius: 999, padding: '5px 14px', cursor: 'pointer' }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              style={{ fontSize: 13, fontWeight: 600, background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 999, padding: '6px 16px', cursor: 'pointer' }}
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}
