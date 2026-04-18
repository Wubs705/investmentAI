import { useState, type ReactNode } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Navbar from './components/Navbar'
import HomePage from './pages/HomePage'
import SearchResultsPage from './pages/SearchResultsPage'
import PropertyDetailPage from './pages/PropertyDetailPage'
import MarketOverviewPage from './pages/MarketOverviewPage'
import HowItWorksPage from './pages/HowItWorksPage'
import AuthModal from './components/auth/AuthModal'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthProvider } from './contexts/AuthContext'
import { setTestMode, getTestMode } from './api/client'

function TestModeBanner() {
  const [enabled, setEnabled] = useState(getTestMode())

  function toggle() {
    const next = !enabled
    setEnabled(next)
    setTestMode(next)
  }

  return (
    <div className={`flex items-center justify-center gap-3 px-4 py-1.5 text-xs font-medium border-b ${
      enabled
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-gray-50 text-gray-500 border-gray-200'
    }`}>
      <span>{enabled ? 'TEST MODE — AI calls disabled (no API costs)' : 'Test Mode'}</span>
      <button
        onClick={toggle}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
          enabled ? 'bg-amber-500' : 'bg-gray-300'
        }`}
      >
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow ${
          enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`} />
      </button>
    </div>
  )
}

const pageVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
}

const pageTransition = {
  duration: 0.2,
  ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
}

interface AnimatedPageProps {
  children: ReactNode
}

function AnimatedPage({ children }: AnimatedPageProps) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={pageTransition}
    >
      {children}
    </motion.div>
  )
}

interface WithNavProps {
  children: ReactNode
}

function WithNav({ children }: WithNavProps) {
  return (
    <>
      <Navbar />
      {children}
    </>
  )
}

function AppRoutes() {
  const location = useLocation()

  return (
    <div className="min-h-screen bg-white">
      <TestModeBanner />
      <AuthModal />

      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={
            <AnimatedPage>
              <WithNav><HomePage /></WithNav>
            </AnimatedPage>
          } />
          <Route path="/results" element={
            <ProtectedRoute>
              <AnimatedPage><SearchResultsPage /></AnimatedPage>
            </ProtectedRoute>
          } />
          <Route path="/property/:id" element={
            <ProtectedRoute>
              <AnimatedPage><PropertyDetailPage /></AnimatedPage>
            </ProtectedRoute>
          } />
          <Route path="/market" element={
            <AnimatedPage>
              <WithNav><MarketOverviewPage /></WithNav>
            </AnimatedPage>
          } />
          <Route path="/how-it-works" element={
            <AnimatedPage>
              <WithNav><HowItWorksPage /></WithNav>
            </AnimatedPage>
          } />
        </Routes>
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
