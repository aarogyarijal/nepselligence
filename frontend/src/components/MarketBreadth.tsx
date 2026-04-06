'use client'

import { useEffect, useState, useCallback } from 'react'
import { fetchMarketBreadth } from '@/lib/api'
import { usePolling } from '@/hooks/usePolling'
import type { MarketBreadth } from '@/types/market'
import type { TimeRange } from '@/app/page'

interface MarketBreadthProps {
  isOpen: boolean
  range: TimeRange
}

export default function MarketBreadthWidget({ isOpen, range }: MarketBreadthProps) {
  const [breadth, setBreadth] = useState<MarketBreadth | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const envelope = await fetchMarketBreadth(range)
      setBreadth(envelope.data ?? null)
    } catch {
      setBreadth(null)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { setLoading(true); load() }, [load])
  usePolling(load, 60_000, isOpen && range === '1D')

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-6 bg-slate-700 rounded" />
        <div className="h-4 bg-slate-700 rounded w-3/4" />
      </div>
    )
  }

  if (!breadth) {
    return <p className="text-slate-500 text-sm text-center py-4">No breadth data</p>
  }

  const total = breadth.total || 1
  const advPct = (breadth.advances / total) * 100
  const decPct = (breadth.declines / total) * 100
  const unchPct = (breadth.unchanged / total) * 100

  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="flex h-5 rounded overflow-hidden">
        <div className="bg-up transition-all" style={{ width: `${advPct}%` }} title={`Advances: ${breadth.advances}`} />
        <div className="bg-flat transition-all" style={{ width: `${unchPct}%` }} title={`Unchanged: ${breadth.unchanged}`} />
        <div className="bg-down transition-all" style={{ width: `${decPct}%` }} title={`Declines: ${breadth.declines}`} />
      </div>

      {/* Counts */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <div className="text-up font-bold text-lg">{breadth.advances}</div>
          <div className="text-slate-500">Advances</div>
        </div>
        <div>
          <div className="text-flat font-bold text-lg">{breadth.unchanged}</div>
          <div className="text-slate-500">Unchanged</div>
        </div>
        <div>
          <div className="text-down font-bold text-lg">{breadth.declines}</div>
          <div className="text-slate-500">Declines</div>
        </div>
      </div>

      {/* A/D Ratio */}
      {breadth.adRatio != null && (
        <div className="text-center text-xs text-slate-400">
          A/D Ratio: <span className={`font-semibold ${breadth.adRatio >= 1 ? 'text-up' : 'text-down'}`}>
            {breadth.adRatio.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  )
}
