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
}

export default function TopGainers({ isOpen, range, onSymbolClick }: TopGainersProps) {
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
  usePolling(load, 60_000, isOpen && range === '1D')

  return (
    <div>
      <div className="grid grid-cols-5 gap-1 pb-2 mb-1 border-b border-slate-700 text-xs font-semibold text-slate-500 uppercase tracking-wider">
        <div>#</div>
        <div className="col-span-2">Symbol</div>
        <div className="text-right">LTP</div>
        <div className="text-right">%</div>
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
              <button
                key={stock.symbol}
                onClick={() => onSymbolClick(stock.symbol)}
                className="w-full grid grid-cols-5 gap-1 py-1.5 px-2 rounded text-xs hover:bg-slate-800 transition-colors text-left"
                style={{ backgroundColor: `rgba(22, 163, 74, ${intensity * 0.15})` }}
                title={`View ${stock.symbol} detail`}
              >
                <div className="text-slate-500">{stock.rank}</div>
                <div className="col-span-2 font-semibold text-white">{stock.symbol}</div>
                <div className="text-right text-slate-300">{formatPrice(stock.ltp)}</div>
                <div className="text-right text-up font-medium">
                  ▲ {formatChangePct(stock.changePct)}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
