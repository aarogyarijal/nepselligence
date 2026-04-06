'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { MarketStatusCtx } from '@/hooks/useMarketStatus'
import MarketStatusBar from '@/components/MarketStatusBar'
import IndexChart from '@/components/IndexChart'
import SectorPerformance from '@/components/SectorPerformance'
import TopGainers from '@/components/TopGainers'
import TopLosers from '@/components/TopLosers'
import TurnoverLeaders from '@/components/TurnoverLeaders'
import MarketBreadthWidget from '@/components/MarketBreadth'
import AIPanel from '@/components/AIPanel'
import AdminControls from '@/components/AdminControls'
import NewsFeed from '@/components/NewsFeed'
import WidgetShell from '@/components/WidgetShell'
import FloorsheetModal from '@/components/FloorsheetModal'
import { fetchMarketOverview } from '@/lib/api'
import { usePolling } from '@/hooks/usePolling'
import type { TimeInterval } from '@/types/market'
import { VALID_INTERVALS, DEFAULT_INTERVAL } from '@/types/market'

export type TimeRange = '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '5Y'
const RANGES: TimeRange[] = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y']

export default function Dashboard() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [range, setRange] = useState<TimeRange>('1D')
  const [interval, setInterval] = useState<TimeInterval>('1min')
  const [floorsheetSymbol, setFloorsheetSymbol] = useState<string | null>(null)

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

  const handleRangeChange = (r: TimeRange) => {
    setRange(r)
    const valid = VALID_INTERVALS[r]
    if (!valid.includes(interval)) setInterval(DEFAULT_INTERVAL[r])
  }

  const handleSymbolSelect = (symbol: string) => {
    router.push(`/stock/${encodeURIComponent(symbol)}`)
  }

  return (
    <MarketStatusCtx.Provider value={{ isOpen, lastUpdated }}>
      <div className="min-h-screen bg-slate-950 flex flex-col">
        {/* W1: Market Status Bar */}
        <MarketStatusBar onSymbolSearch={handleSymbolSelect} isOpen={isOpen} />

        {/* Global Time Range + Interval Selector */}
        <div className="border-b border-slate-800 bg-slate-950 px-6 py-2">
          <div className="max-w-[1600px] mx-auto flex items-center gap-1 flex-wrap">
            <span className="text-xs text-slate-500 mr-2 font-medium uppercase tracking-wider">Range</span>
            {RANGES.map(r => (
              <button
                key={r}
                onClick={() => handleRangeChange(r)}
                className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                  range === r
                    ? 'bg-slate-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {r}
              </button>
            ))}
            <div className="w-px h-4 bg-slate-700 mx-2" />
            <span className="text-xs text-slate-500 mr-2 font-medium uppercase tracking-wider">Interval</span>
            {VALID_INTERVALS[range].map(iv => (
              <button
                key={iv}
                onClick={() => setInterval(iv)}
                className={`px-3 py-1 text-xs rounded font-semibold transition-colors ${
                  interval === iv
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                {iv}
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
                  <IndexChart isOpen={isOpen} range={range} interval={interval} />
                </div>
              </WidgetShell>
            </div>
            <div className="col-span-4">
              <WidgetShell title="Sector Performance" className="h-80">
                <SectorPerformance isOpen={isOpen} range={range} interval={interval} />
              </WidgetShell>
            </div>
          </div>

          {/* ROW 2: Top Gainers + Top Losers + Turnover Leaders */}
          <div className="grid grid-cols-12 gap-6 mb-6">
            <div className="col-span-3">
              <WidgetShell title="Top Gainers" className="h-[26rem] overflow-y-auto">
                <TopGainers isOpen={isOpen} range={range} onSymbolClick={handleSymbolSelect} onFloorsheetClick={setFloorsheetSymbol} />
              </WidgetShell>
            </div>
            <div className="col-span-3">
              <WidgetShell title="Top Losers" className="h-[26rem] overflow-y-auto">
                <TopLosers isOpen={isOpen} range={range} onSymbolClick={handleSymbolSelect} onFloorsheetClick={setFloorsheetSymbol} />
              </WidgetShell>
            </div>
            <div className="col-span-6">
              <WidgetShell title="Turnover Leaders" className="h-[26rem]">
                <TurnoverLeaders isOpen={isOpen} range={range} onSymbolClick={handleSymbolSelect} onFloorsheetClick={setFloorsheetSymbol} />
              </WidgetShell>
            </div>
          </div>

          {/* ROW 3: Market Breadth + AI Insights */}
          <div className="grid grid-cols-12 gap-6 mb-6">
            <div className="col-span-4">
              <WidgetShell title="Market Breadth" className="h-96">
                <MarketBreadthWidget isOpen={isOpen} range={range} />
              </WidgetShell>
            </div>
            <div className="col-span-8">
              <div className="h-96">
                <AIPanel isOpen={isOpen} />
              </div>
            </div>
          </div>

          {/* Row 4: News Feed */}
          <NewsFeed />

        </main>

        {/* W10: Admin Controls (collapsed footer) */}
        <AdminControls />

        <FloorsheetModal symbol={floorsheetSymbol} onClose={() => setFloorsheetSymbol(null)} />
      </div>
    </MarketStatusCtx.Provider>
  )
}
