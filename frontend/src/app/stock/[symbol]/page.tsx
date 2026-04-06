'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { fetchStockAnalysis } from '@/lib/api'
import type { StockAnalysis } from '@/types/market'
import StockHeader from '@/components/stock/StockHeader'
import SignalsCard from '@/components/stock/SignalsCard'
import ReturnsCard from '@/components/stock/ReturnsCard'
import TechnicalsCard from '@/components/stock/TechnicalsCard'
import VolumeCard from '@/components/stock/VolumeCard'
import VolatilityCard from '@/components/stock/VolatilityCard'
import RelPerfCard from '@/components/stock/RelPerfCard'
import FloorsheetCard from '@/components/stock/FloorsheetCard'
import StockChartPanel from '@/components/stock/StockChartPanel'
import StockAIPanel from '@/components/stock/StockAIPanel'
import StockNewsCard from '@/components/stock/StockNewsCard'

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

        {/* Unified price chart with range + interval selectors */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Price Chart</h2>
          <StockChartPanel symbol={symbol} />
        </div>

        {/* Row 1: News | Technicals | Signals + Returns — equal thirds, equal height */}
        <div className="grid grid-cols-3 gap-6 items-stretch">
          <div className="flex flex-col">
            <StockNewsCard symbol={symbol} />
          </div>
          <div className="flex flex-col">
            <TechnicalsCard technicals={analysis.technicals} />
          </div>
          <div className="flex flex-col gap-6">
            <SignalsCard signals={analysis.signals} />
            <ReturnsCard returns={analysis.returns} />
          </div>
        </div>

        {/* Row 2: Volume + Volatility + RelPerf */}
        <div className="grid grid-cols-3 gap-6">
          <VolumeCard volume={analysis.volume} />
          <VolatilityCard volatility={analysis.volatility} />
          <RelPerfCard relativePerformance={analysis.relativePerformance} />
        </div>

        {/* Row 3: AI Analysis + Chat */}
        <StockAIPanel symbol={symbol} />

        {/* Row 4: Floorsheet (conditional) */}
        {analysis.floorsheet && (
          <FloorsheetCard floorsheet={analysis.floorsheet} />
        )}
      </main>
    </div>
  )
}
