'use client'

import { ReactNode, memo } from 'react'

interface WidgetShellProps {
  title?: string
  /** The time period the card's numbers cover, shown beside the title (e.g. "Today", "1M") */
  period?: string
  loading?: boolean
  error?: string | null
  empty?: boolean
  emptyMessage?: string
  onRetry?: () => void
  className?: string
  style?: React.CSSProperties
  scrollable?: boolean
  children: ReactNode
}

/** Shared wrapper for all dashboard widgets. Handles loading/error/empty states uniformly. */
function WidgetShell({
  title,
  period,
  loading,
  error,
  empty,
  emptyMessage = 'No data available',
  onRetry,
  className = '',
  style,
  scrollable = false,
  children,
}: WidgetShellProps) {
  return (
    <div
      className={`bg-slate-900 rounded-lg border border-slate-700 p-6 flex flex-col ${className}`}
      style={style}
      role="region"
      aria-label={title}
      aria-busy={loading}
    >
      {title && (
        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
          <h2 className="text-xl font-semibold text-white min-w-0 truncate">{title}</h2>
          {period && (
            <span
              className="shrink-0 px-2 py-0.5 rounded border border-slate-700 bg-slate-800 text-xs font-medium text-slate-300 whitespace-nowrap"
              title="Time period shown"
            >
              {period}
            </span>
          )}
        </div>
      )}

      <div className={`flex-1 min-h-0${scrollable ? ' overflow-y-auto' : ''}`}>
      {loading ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 bg-slate-700 rounded w-3/4" />
          <div className="h-4 bg-slate-700 rounded w-1/2" />
          <div className="h-4 bg-slate-700 rounded w-2/3" />
          <div className="h-4 bg-slate-700 rounded w-1/3" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-slate-400 text-sm mb-3">{error}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      ) : empty ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-slate-500 text-sm">{emptyMessage}</p>
        </div>
      ) : (
        children
      )}
      </div>
    </div>
  )
}

export default memo(WidgetShell)
