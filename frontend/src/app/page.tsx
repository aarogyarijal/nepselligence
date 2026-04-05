'use client'

import { useEffect, useState } from 'react'
import IndexChart from '@/components/IndexChart'
import TopMovers from '@/components/TopMovers'
import Watchlist from '@/components/Watchlist'
import AIPanel from '@/components/AIPanel'
import TimeRangeSelector from '@/components/TimeRangeSelector'

type TimeRange = '1D' | '5D' | '1M' | '3M'

export default function Dashboard() {
  const [timeRange, setTimeRange] = useState<TimeRange>('1D')

  useEffect(() => {
    // Verify backend connectivity on mount
    fetch('http://localhost:8080/health', {
      mode: 'no-cors',
    })
      .catch(() => {
        // Log connection errors silently for MVP
      })
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-4xl font-bold text-white mb-2">NEPSE Dashboard</h1>
          <p className="text-slate-400">Real-time market intelligence</p>
        </div>

        {/* Time range selector */}
        <div className="mb-6">
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        </div>

        {/* Index Chart - Full width, 30% viewport height */}
        <div className="mb-6 bg-slate-900 rounded-lg p-6 border border-slate-700 h-[30vh]">
          <h2 className="text-xl font-semibold text-white mb-4">NEPSE Index</h2>
          <IndexChart timeRange={timeRange} />
        </div>

        {/* Two-column layout: Top Movers (40%) + Watchlist (60%) */}
        <div className="grid grid-cols-5 gap-6 mb-6">
          {/* Top Movers - 40% width (2 of 5 columns) */}
          <div className="col-span-2 bg-slate-900 rounded-lg p-6 border border-slate-700 max-h-96 overflow-y-auto">
            <h2 className="text-xl font-semibold text-white mb-4">Top Movers</h2>
            <TopMovers />
          </div>

          {/* Watchlist - 60% width (3 of 5 columns) */}
          <div className="col-span-3 bg-slate-900 rounded-lg p-6 border border-slate-700 max-h-96 overflow-y-auto">
            <h2 className="text-xl font-semibold text-white mb-4">Watchlist</h2>
            <Watchlist />
          </div>
        </div>

        {/* AI Panel - Full width, collapsible */}
        <AIPanel />
      </div>
    </main>
  )
}
