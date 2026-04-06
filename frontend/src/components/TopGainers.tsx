'use client'

import { useEffect, useState, useCallback } from 'react'
import { fetchTopGainers } from '@/lib/api'
import { formatPrice, formatChangePct } from '@/lib/format'
import { usePolling } from '@/hooks/usePolling'
import type { TopMover } from '@/types/market'
import type { TimeRange } from '@/app/page'

interface TopGainersProps {
  isOpen: boolean
  range: TimeRange
  onSymbolClick: (symbol: string) => void
  onFloorsheetClick?: (symbol: string) => void
}

export default function TopGainers({ isOpen, range, onSymbolClick, onFloorsheetClick }: TopGainersProps) {
  const [gainers, setGainers] = useState<TopMover[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const envelope = await fetchTopGainers(range)
      setGainers(envelope.data ? envelope.data.slice(0, 10) : [])
    } catch {
      setGainers([])
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { setLoading(true); load() }, [load])
  usePolling(load, 30_000, isOpen && range === '1D')

  return (
    <div>
      <div className="grid gap-1 pb-2 mb-1 border-b border-slate-700 text-xs font-semibold text-slate-500 uppercase tracking-wider"
           style={{ gridTemplateColumns: '1.2rem 1fr 4.5rem 3.5rem 1.2rem' }}>
        <div>#</div>
        <div>Symbol</div>
        <div className="text-right">LTP</div>
        <div className="text-right">%</div>
        <div />
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse mt-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-6 bg-slate-700 rounded" />
          ))}
        </div>
      ) : gainers.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-6">No data</p>
      ) : (
        <div className="space-y-0.5">
          {gainers.map((stock) => {
            const intensity = Math.min(stock.changePct / 10, 1)
            return (
              <div
                key={stock.symbol}
                className="group grid gap-1 py-1.5 px-2 rounded text-xs hover:bg-slate-800 transition-colors items-center"
                style={{ gridTemplateColumns: '1.2rem 1fr 4.5rem 3.5rem 1.2rem', backgroundColor: `rgba(22, 163, 74, ${intensity * 0.15})` }}
              >
                <div className="text-slate-500">{stock.rank}</div>
                <button
                  onClick={() => onSymbolClick(stock.symbol)}
                  className="font-semibold text-white text-left hover:text-blue-300 transition-colors truncate"
                  title={`View ${stock.symbol} analysis`}
                >
                  {stock.symbol}
                </button>
                <div className="text-right text-slate-300 tabular-nums">{formatPrice(stock.ltp)}</div>
                <div className="text-right text-up font-medium whitespace-nowrap tabular-nums">
                  ▲ {formatChangePct(stock.changePct)}
                </div>
                {onFloorsheetClick ? (
                  <button
                    onClick={() => onFloorsheetClick(stock.symbol)}
                    className="text-slate-600 hover:text-slate-300 transition-colors text-right opacity-0 group-hover:opacity-100"
                    title={`View ${stock.symbol} floorsheet`}
                  >
                    ≡
                  </button>
                ) : <div />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
