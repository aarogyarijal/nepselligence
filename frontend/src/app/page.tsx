'use client'

import { useState, useEffect } from 'react'
import { MarketStatusCtx } from '@/hooks/useMarketStatus'
import MarketStatusBar from '@/components/MarketStatusBar'
import IndexChart from '@/components/IndexChart'
import SectorPerformance from '@/components/SectorPerformance'
import TopGainers from '@/components/TopGainers'
import TopLosers from '@/components/TopLosers'
import TurnoverLeaders from '@/components/TurnoverLeaders'
import MarketBreadthWidget from '@/components/MarketBreadth'
import AIPanel from '@/components/AIPanel'
import StockDetail from '@/components/StockDetail'
import AdminControls from '@/components/AdminControls'
import WidgetShell from '@/components/WidgetShell'
import { fetchMarketOverview } from '@/lib/api'
import { usePolling } from '@/hooks/usePolling'

export type TimeRange = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '5Y'
const RANGES: TimeRange[] = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y']

export default function Dashboard() {
  const [isOpen, setIsOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [range, setRange] = useState<TimeRange>('1D')

  const loadMarketStatus = async () => {
    try {
      const envelope = await fetchMarketOverview()
      if (envelope.data) {
        setIsOpen(envelope.data.isOpen)
        setLastUpdated(envelope.data.lastUpdated)
      }
    } catch {}
  }

  useEffect(() => { loadMarketStatus() }, [])
  usePolling(loadMarketStatus, 60_000, true)

  const handleSymbolSelect = (symbol: string) => {
    setSelectedSymbol(symbol)
    setTimeout(() => {
      document.getElementById('stock-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  return (
    <MarketStatusCtx.Provider value={{ isOpen, lastUpdated }}>
      <div className="min-h-screen bg-slate-950 flex flex-col">
        {/* W1: Market Status Bar */}
        <MarketStatusBar onSymbolSearch={handleSymbolSelect} isOpen={isOpen} />

        {/* Global Time Range Selector */}
        <div className="border-b border-slate-800 bg-slate-950 px-6 py-2">
          <div className="max-w-[1600px] mx-auto flex items-center gap-1">
            <span className="text-xs text-slate-500 mr-2 font-medium uppercase tracking-wider">Range</span>
            {RANGES.map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                  range === r
                    ? 'bg-slate-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <main className="flex-1 p-6 max-w-[1600px] mx-auto w-full">
          {/* ROW 1: NEPSE Index Chart + Sector Performance */}
          <div className="grid grid-cols-12 gap-6 mb-6">
            <div className="col-span-8">
              <WidgetShell title="NEPSE Index" className="h-80">
                <div className="h-56">
                  <IndexChart isOpen={isOpen} range={range} />
                </div>
              </WidgetShell>
            </div>
            <div className="col-span-4">
              <WidgetShell title="Sector Performance" className="h-80">
                <SectorPerformance isOpen={isOpen} range={range} />
              </WidgetShell>
            </div>
          </div>

          {/* ROW 2: Top Gainers + Top Losers + Turnover Leaders */}
          <div className="grid grid-cols-12 gap-6 mb-6">
            <div className="col-span-3">
              <WidgetShell title="Top Gainers" className="max-h-96 overflow-y-auto">
                <TopGainers isOpen={isOpen} range={range} onSymbolClick={handleSymbolSelect} />
              </WidgetShell>
            </div>
            <div className="col-span-3">
              <WidgetShell title="Top Losers" className="max-h-96 overflow-y-auto">
                <TopLosers isOpen={isOpen} range={range} onSymbolClick={handleSymbolSelect} />
              </WidgetShell>
            </div>
            <div className="col-span-6">
              <WidgetShell title="Turnover Leaders" className="h-96">
                <TurnoverLeaders isOpen={isOpen} range={range} onSymbolClick={handleSymbolSelect} />
              </WidgetShell>
            </div>
          </div>

          {/* ROW 3: Market Breadth + AI Insights */}
          <div className="grid grid-cols-12 gap-6 mb-6">
            <div className="col-span-4">
              <WidgetShell title="Market Breadth" className="h-64">
                <MarketBreadthWidget isOpen={isOpen} range={range} />
              </WidgetShell>
            </div>
            <div className="col-span-8">
              <div className="h-64">
                <AIPanel isOpen={isOpen} />
              </div>
            </div>
          </div>

          {/* ROW 4: Stock Detail (visible when symbol selected) */}
          {selectedSymbol && (
            <div id="stock-detail" className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <span />
                <button
                  onClick={() => setSelectedSymbol(null)}
                  className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
                >
                  ✕ Close
                </button>
              </div>
              <StockDetail symbol={selectedSymbol} />
            </div>
          )}
        </main>

        {/* W10: Admin Controls (collapsed footer) */}
        <AdminControls />
      </div>
    </MarketStatusCtx.Provider>
  )
}
