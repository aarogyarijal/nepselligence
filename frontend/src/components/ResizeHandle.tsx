'use client'

import type { ResizeHandleBindings } from '@/hooks/useResizableHeight'

interface ResizeHandleProps {
  handleProps: ResizeHandleBindings
  className?: string
}

/** Drag bar that resizes the chart above it. Works with mouse, finger, pen and arrow keys. */
export default function ResizeHandle({ handleProps, className = '' }: ResizeHandleProps) {
  return (
    <div
      {...handleProps}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize chart"
      tabIndex={0}
      className={`h-8 cursor-row-resize touch-none select-none flex items-center justify-center group shrink-0 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-500 ${className}`}
    >
      <div className="w-8 h-0.5 touch:w-12 touch:h-1 rounded-full bg-slate-700 group-hover:bg-slate-500 group-active:bg-slate-400 transition-colors" />
    </div>
  )
}
