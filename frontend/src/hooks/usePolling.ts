'use client'

import { useEffect, useRef } from 'react'

/**
 * Polls a callback at the given interval.
 *
 * Respects:
 * - Page Visibility API: pauses when tab is hidden, resumes on focus
 * - enabled flag: stops polling when false (e.g., market is closed)
 * - Jitter: random initial delay (up to 20% of intervalMs) to prevent all
 *   polling components from firing simultaneously at t=0, t=30s, t=60s, etc.
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

    const onVisibility = () => {
      if (!document.hidden) callbackRef.current()
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Stagger start: random jitter up to 20% of interval so components don't
    // all fire their first poll at the exact same wall-clock time.
    const jitter = Math.random() * intervalMs * 0.2
    let intervalId: ReturnType<typeof setInterval>
    const timeoutId = setTimeout(() => {
      intervalId = setInterval(tick, intervalMs)
    }, jitter)

    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, enabled])
}
