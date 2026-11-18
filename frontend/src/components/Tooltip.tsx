'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

const TOOLTIP_WIDTH = 280
const MARGIN = 12  // min distance from viewport edge

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  placement?: 'top' | 'bottom'
}

export function Tooltip({ content, children, placement = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  // True when the last press came from a finger or pen, which has no hover to rely on
  const touchRef = useRef(false)

  const show = () => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    const vw = window.innerWidth

    // Center on the trigger, then clamp so the box stays on screen
    const rawX = r.left + r.width / 2
    const halfW = TOOLTIP_WIDTH / 2
    const clampedX = Math.min(Math.max(rawX, MARGIN + halfW), vw - MARGIN - halfW)

    setCoords({
      x: clampedX,
      y: placement === 'top' ? r.top : r.bottom,
    })
    setVisible(true)
  }

  const hide = () => setVisible(false)

  // While open, a tap anywhere else or any scroll closes it (it is position: fixed)
  useEffect(() => {
    if (!visible) return
    const onDown = (e: PointerEvent) => {
      if (!triggerRef.current?.contains(e.target as Node)) setVisible(false)
    }
    const onScroll = () => setVisible(false)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [visible])

  return (
    <>
      <span
        ref={triggerRef}
        onPointerEnter={e => { if (e.pointerType === 'mouse') show() }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') hide() }}
        onPointerDown={e => { touchRef.current = e.pointerType !== 'mouse' }}
        onClick={() => { if (touchRef.current) (visible ? hide() : show()) }}
        onFocus={show}
        onBlur={hide}
        className="inline-flex items-center"
      >
        {children}
      </span>
      {visible && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none"
            style={{
              left: coords.x,
              top: placement === 'top' ? coords.y - 8 : coords.y + 8,
              transform: placement === 'top'
                ? 'translate(-50%, -100%)'
                : 'translate(-50%, 0)',
              width: TOOLTIP_WIDTH,
            }}
          >
            <div className="bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded-lg px-3 py-2 shadow-xl leading-relaxed whitespace-normal">
              {content}
            </div>
            <div
              className={`absolute left-1/2 -translate-x-1/2 w-0 h-0 ${
                placement === 'top'
                  ? 'top-full border-x-4 border-x-transparent border-t-4 border-t-slate-600'
                  : 'bottom-full border-x-4 border-x-transparent border-b-4 border-b-slate-600'
              }`}
            />
          </div>,
          document.body
        )
      }
    </>
  )
}

export function TipLabel({
  label,
  tip,
  className = '',
}: {
  label: string
  tip: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip content={tip}>
      <span
        className={`cursor-help border-b border-dashed border-slate-600 hover:border-slate-400 transition-colors ${className}`}
      >
        {label}
      </span>
    </Tooltip>
  )
}
