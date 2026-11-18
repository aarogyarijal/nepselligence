'use client'

import { createContext, useContext } from 'react'
import type { TourLang, TourPage, TourStep } from './tourSteps'

export interface TourState {
  running: boolean
  steps: TourStep[]
  index: number
  lang: TourLang
  /** Which way the user last moved: 1 = forward, -1 = back */
  direction: 1 | -1
  start: (from: TourPage) => void
  /** On the last step, closes the tour */
  next: () => void
  /** Does nothing on the first step */
  back: () => void
  close: () => void
  /** Move past a step whose panel never appeared; closes the tour at either end */
  skip: (direction: 1 | -1) => void
  setLang: (lang: TourLang) => void
}

export const TourCtx = createContext<TourState | null>(null)

export function useTour(): TourState {
  const ctx = useContext(TourCtx)
  if (!ctx) throw new Error('useTour must be used inside <TourProvider>')
  return ctx
}

/** Which tour page a path belongs to, or null for pages the tour does not cover */
export function pageOf(pathname: string | null): TourPage | null {
  if (!pathname) return null
  if (pathname === '/') return 'dashboard'
  if (pathname.startsWith('/stock/')) return 'stock'
  return null
}
