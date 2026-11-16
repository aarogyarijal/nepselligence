'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
import ResizeHandle from '@/components/ResizeHandle'
import { useResizableHeight } from '@/hooks/useResizableHeight'
import FloorsheetModal from '@/components/FloorsheetModal'
import TradeActivity from '@/components/TradeActivity'
import { fetchMarketOverview } from '@/lib/api'
import { usePolling } from '@/hooks/usePolling'
import type { TimeInterval } from '@/types/market'
import { VALID_INTERVALS, DEFAULT_INTERVAL } from '@/types/market'

export type TimeRange = 'today' | 'last_day' | '5D' | '1M' | '3M' | '6M' | '1Y'
const RANGES: TimeRange[] = ['today', 'last_day', '5D', '1M', '3M', '6M', '1Y']
const RANGE_LABELS: Record<TimeRange, string> = {
  today: 'Today', last_day: 'Last Day', '5D': '5D', '1M': '1M', '3M': '3M', '6M': '6M', '1Y': '1Y',
}

const DEBOUNCE_MS = 150

export default function Dashboard() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  // UI state (for button highlighting, updates instantly)
  const [range, setRange] = useState<TimeRange>('today')
  const [interval, setInterval] = useState<TimeInterval>('1min')
  // Debounced state (passed to children, updates after DEBOUNCE_MS)
  const [activeRange, setActiveRange] = useState<TimeRange>('today')
  const [activeInterval, setActiveInterval] = useState<TimeInterval>('1min')
  const [floorsheetSymbol, setFloorsheetSymbol] = useState<string | null>(null)
  const { height: chartHeight, handleProps: chartHandleProps } = useResizableHeight('nepse-chart-height', 320)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

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

  // Debounce: propagate range/interval to children after rapid clicking settles
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setActiveRange(range)
      setActiveInterval(interval)
    }, DEBOUNCE_MS)
    return () => clearTimeout(debounceRef.current)
  }, [range, interval])

  const handleRangeChange = useCallback((r: TimeRange) => {
    setRange(r)
    const valid = VALID_INTERVALS[r]
    if (!valid.includes(interval)) setInterval(DEFAULT_INTERVAL[r])
  }, [interval])

  const handleSymbolSelect = useCallback((symbol: string) => {
    router.push(`/stock/${encodeURIComponent(symbol)}`)
  }, [router])

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
                {RANGE_LABELS[r]}
              </button>
            ))}
            {!['5D', '1M', '3M', '6M', '1Y'].includes(range) && (
              <>
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
              </>
            )}
          </div>
        </div>

        <main className="flex-1 p-6 max-w-[1600px] mx-auto w-full">
          {/* ROW 1: NEPSE Index Chart + Sector Performance */}
          <div className="grid grid-cols-12 gap-6 mb-6" style={{ gridTemplateRows: `${chartHeight}px` }}>
            <div className="col-span-8">
              <WidgetShell title="NEPSE Index" className="h-full">
                <IndexChart isOpen={isOpen} range={activeRange} interval={activeInterval} />
              </WidgetShell>
            </div>
            <div className="col-span-4">
              <WidgetShell title="Sector Performance" className="h-full" scrollable>
                <SectorPerformance isOpen={isOpen} range={activeRange} interval={activeInterval} />
              </WidgetShell>
            </div>
          </div>
          <ResizeHandle onMouseDown={chartHandleProps.onMouseDown} />

          {/* ROW 2: Top Gainers + Top Losers + Turnover Leaders */}
          <div className="grid grid-cols-12 gap-6 mb-6">
            <div className="col-span-3">
              <WidgetShell title="Top Gainers" className="h-[32rem]" scrollable>
                <TopGainers isOpen={isOpen} range={activeRange} onSymbolClick={handleSymbolSelect} onFloorsheetClick={setFloorsheetSymbol} />
              </WidgetShell>
            </div>
            <div className="col-span-3">
              <WidgetShell title="Top Losers" className="h-[32rem]" scrollable>
                <TopLosers isOpen={isOpen} range={activeRange} onSymbolClick={handleSymbolSelect} onFloorsheetClick={setFloorsheetSymbol} />
              </WidgetShell>
            </div>
            <div className="col-span-6">
              <WidgetShell title="Turnover Leaders" className="h-[32rem]">
                <TurnoverLeaders isOpen={isOpen} range={activeRange} onSymbolClick={handleSymbolSelect} onFloorsheetClick={setFloorsheetSymbol} />
              </WidgetShell>
            </div>
          </div>

          {/* ROW 3: Market Breadth + Trade Activity + AI Insights */}
          <div className="grid grid-cols-12 gap-6 mb-6">
            <div className="col-span-3">
              <WidgetShell title="Market Breadth" className="h-96">
                <MarketBreadthWidget isOpen={isOpen} range={activeRange} />
              </WidgetShell>
            </div>
            <div className="col-span-3">
              <TradeActivity />
            </div>
            <div className="col-span-6">
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
