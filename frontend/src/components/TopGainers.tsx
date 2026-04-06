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
      <div className="grid grid-cols-6 gap-1 pb-2 mb-1 border-b border-slate-700 text-xs font-semibold text-slate-500 uppercase tracking-wider">
        <div>#</div>
        <div className="col-span-2">Symbol</div>
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
                className="group grid grid-cols-6 gap-1 py-1.5 px-2 rounded text-xs hover:bg-slate-800 transition-colors"
                style={{ backgroundColor: `rgba(22, 163, 74, ${intensity * 0.15})` }}
              >
                <div className="text-slate-500 self-center">{stock.rank}</div>
                <button
                  onClick={() => onSymbolClick(stock.symbol)}
                  className="col-span-2 font-semibold text-white text-left hover:text-blue-300 transition-colors"
                  title={`View ${stock.symbol} analysis`}
                >
                  {stock.symbol}
                </button>
                <div className="text-right text-slate-300 self-center">{formatPrice(stock.ltp)}</div>
                <div className="text-right text-up font-medium self-center">
                  ▲ {formatChangePct(stock.changePct)}
                </div>
                {onFloorsheetClick && (
                  <button
                    onClick={() => onFloorsheetClick(stock.symbol)}
                    className="text-slate-600 hover:text-slate-300 transition-colors text-right opacity-0 group-hover:opacity-100"
                    title={`View ${stock.symbol} floorsheet`}
                  >
                    ≡
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
