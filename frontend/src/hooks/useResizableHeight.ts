'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const MIN_HEIGHT = 200
const MAX_HEIGHT = 800
const KEY_STEP = 16

const clamp = (h: number) => Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h)))

export interface ResizeHandleBindings {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void
}

export function useResizableHeight(storageKey: string, defaultHeight: number) {
  const [height, setHeight] = useState(defaultHeight)
  const rafRef = useRef<number>(0)

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      const parsed = parseInt(stored, 10)
      if (!isNaN(parsed) && parsed >= MIN_HEIGHT && parsed <= MAX_HEIGHT) setHeight(parsed)
    }
  }, [storageKey])

  // Pointer events cover mouse, finger and pen with one code path
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    const pointerId = e.pointerId
    const startY = e.clientY
    const startH = height
    let latest = startH

    el.setPointerCapture(pointerId)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      latest = clamp(startH + ev.clientY - startY)
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => setHeight(latest))
    }

    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onEnd)
      el.removeEventListener('pointercancel', onEnd)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      cancelAnimationFrame(rafRef.current)
      setHeight(latest)
      localStorage.setItem(storageKey, String(latest))
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onEnd)
    el.addEventListener('pointercancel', onEnd)
  }, [height, storageKey])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const next = clamp(height + (e.key === 'ArrowDown' ? KEY_STEP : -KEY_STEP))
    setHeight(next)
    localStorage.setItem(storageKey, String(next))
  }, [height, storageKey])

  const handleProps: ResizeHandleBindings = { onPointerDown, onKeyDown }
  return { height, handleProps }
}
