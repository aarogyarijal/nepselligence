'use client'

import { useFreshness } from '@/hooks/useFreshness'
import { formatNPT } from '@/lib/format'

interface FreshnessBadgeProps {
  lastUpdated: string | null | undefined
  marketIsOpen: boolean
}

export default function FreshnessBadge({ lastUpdated, marketIsOpen }: FreshnessBadgeProps) {
  const state = useFreshness(lastUpdated, marketIsOpen)

  if (state === 'fresh' || !lastUpdated) return null

  if (state === 'aging') {
    const mins = Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 60_000)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-yellow-400">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />
        Updated {mins}m ago
      </span>
    )
  }

  // stale
  return (
    <span className="text-xs text-slate-500">
      As of {formatNPT(lastUpdated)}
    </span>
  )
}
