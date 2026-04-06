'use client'

import { useMemo } from 'react'
import type { FreshnessState } from '@/types/market'

/**
 * Determine data freshness based on timestamp and market status.
 *
 * When market is closed, always returns 'fresh' (stale is expected and normal).
 * During market hours:
 *   - fresh: < 5 minutes
 *   - aging: 5–30 minutes
 *   - stale: > 30 minutes
 */
export function useFreshness(
  lastUpdated: string | null | undefined,
  marketIsOpen: boolean
): FreshnessState {
  return useMemo(() => {
    if (!lastUpdated) return 'stale'
    if (!marketIsOpen) return 'fresh' // closed = no stale warnings

    const ageMs = Date.now() - new Date(lastUpdated).getTime()
    const ageMins = ageMs / 60_000

    if (ageMins < 5) return 'fresh'
    if (ageMins < 30) return 'aging'
    return 'stale'
  }, [lastUpdated, marketIsOpen])
}
