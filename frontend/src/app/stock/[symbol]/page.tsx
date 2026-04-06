'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { fetchStockAnalysis } from '@/lib/api'
import type { StockAnalysis } from '@/types/market'
import type { ChartOverlay } from '@/components/CandlestickChart'
import CandlestickChart from '@/components/CandlestickChart'
import StockHeader from '@/components/stock/StockHeader'
import SignalsCard from '@/components/stock/SignalsCard'
import ReturnsCard from '@/components/stock/ReturnsCard'
import TechnicalsCard from '@/components/stock/TechnicalsCard'
import VolumeCard from '@/components/stock/VolumeCard'
import VolatilityCard from '@/components/stock/VolatilityCard'
import RelPerfCard from '@/components/stock/RelPerfCard'
import FloorsheetCard from '@/components/stock/FloorsheetCard'

export default function StockPage() {
  const params = useParams()
  const router = useRouter()
  const symbol = (params?.symbol as string ?? '').toUpperCase()

  const [analysis, setAnalysis] = useState<StockAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!symbol) return
    setLoading(true)
    setError(null)
    fetchStockAnalysis(symbol)
      .then(env => {
        if (!env.data) {
          setError(`Symbol "${symbol}" not found.`)
        } else {
          setAnalysis(env.data)
        }
      })
      .catch(() => setError('Failed to load analysis. Is the backend running?'))
      .finally(() => setLoading(false))
  }, [symbol])

  // Must be declared before any conditional returns (Rules of Hooks)
  const overlays = useMemo<ChartOverlay[]>(() => {
    if (!analysis) return []
    return [
      { label: 'SMA 20', data: analysis.overlays.sma20, color: '#facc15' },
      { label: 'SMA 50', data: analysis.overlays.sma50, color: '#f97316' },
      { label: 'SMA 200', data: analysis.overlays.sma200, color: '#a855f7' },
      { label: 'BB Upper', data: analysis.overlays.bollingerUpper, color: '#64748b', dashed: true },
      { label: 'BB Lower', data: analysis.overlays.bollingerLower, color: '#64748b', dashed: true },
    ].filter(o => o.data.length > 0)
  }, [analysis])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Loading {symbol}...</div>
      </div>
    )
  }

  if (error || !analysis) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <p className="text-slate-300">{error ?? 'No data available.'}</p>
        <button
          onClick={() => router.push('/')}
          className="text-slate-400 hover:text-white text-sm transition-colors"
        >
          ← Back to Dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Nav bar */}
      <div className="border-b border-slate-800 bg-slate-950 px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => router.push('/')}
          className="text-slate-400 hover:text-white text-sm transition-colors flex items-center gap-1"
        >
          ← Dashboard
        </button>
        <span className="text-xs text-slate-600">NEPSE · {symbol}</span>
      </div>

      <main className="flex-1 p-6 max-w-[1600px] mx-auto w-full space-y-6">
        {/* Header */}
        <StockHeader analysis={analysis} />

        {/* Candlestick chart with overlays */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Price Chart</h2>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-3 h-px bg-yellow-400 inline-block" /> SMA 20</span>
              <span className="flex items-center gap-1"><span className="w-3 h-px bg-orange-400 inline-block" /> SMA 50</span>
              <span className="flex items-center gap-1"><span className="w-3 h-px bg-purple-400 inline-block" /> SMA 200</span>
              <span className="flex items-center gap-1"><span className="w-3 h-px bg-slate-500 inline-block border-dashed border-t border-slate-400" /> BB</span>
            </div>
          </div>
          <CandlestickChart data={analysis.history} overlays={overlays} height={380} />
        </div>

        {/* Row 1: Signals + Returns + Technicals */}
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-3">
            <SignalsCard signals={analysis.signals} />
          </div>
          <div className="col-span-3">
            <ReturnsCard returns={analysis.returns} />
          </div>
          <div className="col-span-6">
            <TechnicalsCard technicals={analysis.technicals} />
          </div>
        </div>

        {/* Row 2: Volume + Volatility + RelPerf */}
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-4">
            <VolumeCard volume={analysis.volume} />
          </div>
          <div className="col-span-4">
            <VolatilityCard volatility={analysis.volatility} />
          </div>
          <div className="col-span-4">
            <RelPerfCard relativePerformance={analysis.relativePerformance} />
          </div>
        </div>

        {/* Row 3: Floorsheet (conditional) */}
        {analysis.floorsheet && (
          <FloorsheetCard floorsheet={analysis.floorsheet} />
        )}
      </main>
    </div>
  )
}
