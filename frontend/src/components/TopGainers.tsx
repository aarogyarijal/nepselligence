'use client'

import { useEffect, useState, useCallback, memo } from 'react'
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

function TopGainers({ isOpen, range, onSymbolClick, onFloorsheetClick }: TopGainersProps) {
  const [gainers, setGainers] = useState<TopMover[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const envelope = await fetchTopGainers(range)
      setGainers(envelope.data ? envelope.data.slice(0, 20) : [])
    } catch {
      setGainers([])
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { setLoading(true); load() }, [load])
  usePolling(load, 30_000, isOpen && range === 'today')

  return (
    <div>
      <div className="grid grid-cols-[1.2rem_1fr_4.5rem_3.5rem_1.2rem] touch:grid-cols-[1.2rem_1fr_4.5rem_3.5rem_2.5rem] gap-1 pb-2 mb-1 border-b border-slate-700 text-xs font-semibold text-slate-500 uppercase tracking-wider">
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
                className="group grid grid-cols-[1.2rem_1fr_4.5rem_3.5rem_1.2rem] touch:grid-cols-[1.2rem_1fr_4.5rem_3.5rem_2.5rem] gap-1 py-1.5 touch:py-0 px-2 rounded text-xs hover:bg-slate-800 transition-colors items-center"
                style={{ backgroundColor: `rgba(22, 163, 74, ${intensity * 0.15})` }}
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
                    className="text-slate-600 hover:text-slate-300 transition-colors text-right opacity-0 group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100 touch:text-center touch:text-base touch:text-slate-400"
                    title={`View ${stock.symbol} floorsheet`}
                    aria-label={`View ${stock.symbol} floorsheet`}
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

export default memo(TopGainers)
