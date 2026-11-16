'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

export function useResizableHeight(storageKey: string, defaultHeight: number) {
  const [height, setHeight] = useState(defaultHeight)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const rafRef = useRef<number>(0)

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(storageKey)
    if (stored) {
      const parsed = parseInt(stored, 10)
      if (!isNaN(parsed) && parsed >= 200 && parsed <= 800) setHeight(parsed)
    }
  }, [storageKey])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: height }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const delta = ev.clientY - dragRef.current!.startY
        const next = Math.min(800, Math.max(200, dragRef.current!.startH + delta))
        setHeight(next)
      })
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      cancelAnimationFrame(rafRef.current)
      // Persist final height
      setHeight(h => {
        localStorage.setItem(storageKey, String(h))
        return h
      })
      dragRef.current = null
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [height, storageKey])

  return { height, handleProps: { onMouseDown } }
}
