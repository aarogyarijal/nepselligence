'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { fetchTopTurnover } from '@/lib/api'
import { stepsFor } from './tourSteps'
import type { TourLang, TourPage, TourStep } from './tourSteps'
import { TourCtx, pageOf } from './tourContext'
import type { TourState } from './tourContext'
import TourOverlay from './TourOverlay'

export { useTour } from './tourContext'
export type { TourState } from './tourContext'

const SEEN_KEY = 'nepse-tour-seen'
const LANG_KEY = 'nepse-tour-lang'
/** Share opened for the stock-page half when the day's turnover leader is unknown */
const FALLBACK_SYMBOL = 'NABIL'

// Storage can be missing or blocked (private windows, strict settings); the tour must still run.
function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value) } catch {}
}

function samePath(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  try { return decodeURIComponent(a) === decodeURIComponent(b) } catch { return a === b }
}

interface Progress {
  running: boolean
  steps: TourStep[]
  index: number
  direction: 1 | -1
}

const IDLE: Progress = { running: false, steps: [], index: 0, direction: 1 }

export default function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [progress, setProgress] = useState<Progress>(IDLE)
  const [lang, setLangState] = useState<TourLang>('en')

  const runningRef = useRef(false)
  runningRef.current = progress.running
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname
  /** Share the tour opens for its stock-page half */
  const symbolRef = useRef(FALLBACK_SYMBOL)
  /** The path the tour itself expects to be on; any other path change ends the tour */
  const expectedPathRef = useRef<string | null>(null)
  const prevPathRef = useRef(pathname)

  const start = useCallback((from: TourPage) => {
    const path = pathnameRef.current
    expectedPathRef.current = path
    if (from === 'stock') {
      const raw = (path ?? '').split('/')[2] ?? ''
      let symbol = raw
      try { symbol = decodeURIComponent(raw) } catch {}
      symbolRef.current = symbol || FALLBACK_SYMBOL
    } else {
      symbolRef.current = FALLBACK_SYMBOL
      // Resolved well before the stock-page steps are reached; the fallback covers a failure
      fetchTopTurnover()
        .then(env => {
          const top = env.data?.[0]?.symbol
          if (top) symbolRef.current = top
        })
        .catch(() => {})
    }
    writeStorage(SEEN_KEY, '1')
    setProgress({ running: true, steps: stepsFor(from), index: 0, direction: 1 })
  }, [])

  const close = useCallback(() => setProgress(IDLE), [])

  const skip = useCallback((direction: 1 | -1) => {
    setProgress(p => {
      if (!p.running) return p
      const index = p.index + direction
      if (index < 0 || index >= p.steps.length) return IDLE
      return { ...p, index, direction }
    })
  }, [])

  const next = useCallback(() => skip(1), [skip])

  const back = useCallback(() => {
    setProgress(p => (p.running && p.index > 0 ? { ...p, index: p.index - 1, direction: -1 } : p))
  }, [])

  const setLang = useCallback((next: TourLang) => {
    setLangState(next)
    writeStorage(LANG_KEY, next)
  }, [])

  // Remembered language, and the one-time automatic start on the dashboard.
  // It only starts by itself when the page actually has panels marked for the tour.
  useEffect(() => {
    if (readStorage(LANG_KEY) === 'ne') setLangState('ne')
    if (
      pageOf(pathnameRef.current) === 'dashboard' &&
      readStorage(SEEN_KEY) === null &&
      document.querySelector('[data-tour]')
    ) {
      start('dashboard')
    }
  }, [start])

  // A page change the tour did not ask for (browser Back, a typed address) ends the tour
  useEffect(() => {
    if (prevPathRef.current === pathname) return
    prevPathRef.current = pathname
    if (runningRef.current && !samePath(pathname, expectedPathRef.current)) setProgress(IDLE)
  }, [pathname])

  // Move to the page the current step lives on
  const step = progress.running ? progress.steps[progress.index] : undefined
  const stepPage = step?.page
  useEffect(() => {
    if (!stepPage || pageOf(pathname) === stepPage) return
    const target = stepPage === 'stock' ? `/stock/${encodeURIComponent(symbolRef.current)}` : '/'
    expectedPathRef.current = target
    router.push(target)
  }, [stepPage, pathname, router])

  const value = useMemo<TourState>(() => ({
    running: progress.running,
    steps: progress.steps,
    index: progress.index,
    direction: progress.direction,
    lang,
    start, next, back, close, skip, setLang,
  }), [progress, lang, start, next, back, close, skip, setLang])

  return (
    <TourCtx.Provider value={value}>
      {children}
      <TourOverlay />
    </TourCtx.Provider>
  )
}
