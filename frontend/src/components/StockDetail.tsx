'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { fetchStockHistory } from '@/lib/api'
import { formatPrice } from '@/lib/format'
import type { OHLCVPoint } from '@/types/market'

interface StockDetailProps {
  symbol: string | null
}

// Candlestick chart component — loaded client-only (lightweight-charts needs DOM)
const CandlestickChart = dynamic(() => import('./CandlestickChart'), { ssr: false })

export default function StockDetail({ symbol }: StockDetailProps) {
  const [history, setHistory] = useState<OHLCVPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!symbol) return
    setLoading(true)
    setError(false)

    fetchStockHistory(symbol)
      .then(envelope => {
        setHistory(envelope.data || [])
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [symbol])

  if (!symbol) return null

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-700 p-6">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-xl font-semibold text-white">{symbol}</h2>
        {history.length > 0 && (
          <span className="text-slate-400 text-sm">
            {history.length} trading days · Close: {formatPrice(history[history.length - 1].close)}
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center text-slate-500 text-sm animate-pulse">
          Loading chart...
        </div>
      ) : error ? (
        <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
          Failed to load history for {symbol}
        </div>
      ) : history.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
          No history available. Run a backfill to load data.
        </div>
      ) : (
        <CandlestickChart data={history} />
      )}
    </div>
  )
}
