'use client'

interface ResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void
}

export default function ResizeHandle({ onMouseDown }: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="h-2 cursor-row-resize flex items-center justify-center group shrink-0"
    >
      <div className="w-8 h-0.5 rounded-full bg-slate-700 group-hover:bg-slate-500 transition-colors" />
    </div>
  )
}
