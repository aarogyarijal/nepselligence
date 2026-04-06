'use client'

import { ReactNode, memo } from 'react'

interface WidgetShellProps {
  title?: string
  loading?: boolean
  error?: string | null
  empty?: boolean
  emptyMessage?: string
  onRetry?: () => void
  className?: string
  children: ReactNode
}

/** Shared wrapper for all dashboard widgets. Handles loading/error/empty states uniformly. */
function WidgetShell({
  title,
  loading,
  error,
  empty,
  emptyMessage = 'No data available',
  onRetry,
  className = '',
  children,
}: WidgetShellProps) {
  return (
    <div
      className={`bg-slate-900 rounded-lg border border-slate-700 p-6 flex flex-col ${className}`}
      role="region"
      aria-label={title}
      aria-busy={loading}
    >
      {title && (
        <h2 className="text-xl font-semibold text-white mb-4 shrink-0">{title}</h2>
      )}

      <div className="flex-1 min-h-0">
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
