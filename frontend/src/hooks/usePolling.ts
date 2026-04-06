'use client'

import { useEffect, useRef } from 'react'

/**
 * Polls a callback at the given interval.
 *
 * Respects:
 * - Page Visibility API: pauses when tab is hidden, resumes on focus
 * - enabled flag: stops polling when false (e.g., market is closed)
 */
export function usePolling(
  callback: () => void,
  intervalMs: number,
  enabled: boolean = true
): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!enabled) return

    const tick = () => {
      if (!document.hidden) {
        callbackRef.current()
      }
    }

    const id = setInterval(tick, intervalMs)

    const onVisibility = () => {
      if (!document.hidden) {
        callbackRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, enabled])
}
