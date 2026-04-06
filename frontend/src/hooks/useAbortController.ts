'use client'

import { useRef, useCallback } from 'react'

/**
 * Returns a stable `abort()` function and a `signal()` getter.
 *
 * Usage — call abort() at the top of every new fetch to cancel any pending
 * request from a previous render cycle before starting the next one:
 *
 *   const { signal, abort } = useAbortController()
 *
 *   const refresh = useCallback(async () => {
 *     abort()
 *     try {
 *       const data = await fetchSomething(signal())
 *       setData(data)
 *     } catch (e) {
 *       if ((e as Error).name !== 'AbortError') setError(true)
 *     }
 *   }, [abort, signal])
 *
 * The controller is automatically aborted on component unmount via the
 * cleanup returned from useEffect.
 */
export function useAbortController() {
  const controllerRef = useRef<AbortController | null>(null)

  const abort = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = new AbortController()
  }, [])

  const signal = useCallback(() => {
    if (!controllerRef.current) {
      controllerRef.current = new AbortController()
    }
    return controllerRef.current.signal
  }, [])

  return { abort, signal }
}
