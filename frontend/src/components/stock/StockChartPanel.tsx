'use client'

import { useEffect, useState, useRef } from 'react'
import CandlestickChart from '@/components/CandlestickChart'
import LightweightAreaChart from '@/components/LightweightAreaChart'
import { fetchStockChart } from '@/lib/api'
import type { TimeInterval, StockChartResponse, StockChartPoint, OHLCVPoint } from '@/types/market'
import { VALID_INTERVALS, DEFAULT_INTERVAL } from '@/types/market'
import type { TimeRange } from '@/app/page'

const RANGES: TimeRange[] = ['today', 'last_day', '5D', '1M', '3M', '6M', '1Y']
const RANGE_LABELS: Record<TimeRange, string> = {
  today: 'Today', last_day: 'Last Day', '5D': '5D', '1M': '1M', '3M': '3M', '6M': '6M', '1Y': '1Y',
}

interface StockChartPanelProps {
  symbol: string
}

export default function StockChartPanel({ symbol }: StockChartPanelProps) {
  const [range, setRange] = useState<TimeRange>('today')
  const [interval, setInterval] = useState<TimeInterval>('1min')
  const [response, setResponse] = useState<StockChartResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  const handleRangeChange = (r: TimeRange) => {
    setRange(r)
    const valid = VALID_INTERVALS[r]
    if (!valid.includes(interval)) setInterval(DEFAULT_INTERVAL[r])
  }

  useEffect(() => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setLoading(true)
    fetchStockChart(symbol, range, interval, ac.signal)
      .then(data => {
        if (!ac.signal.aborted) setResponse(data)
      })
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (!ac.signal.aborted) setResponse(null)
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })

    return () => ac.abort()
  }, [symbol, range, interval])

  // Map StockChartResponse data to OHLCVPoint[] for CandlestickChart
  const ohlcvData: OHLCVPoint[] = (response?.type === 'ohlcv' ? response.data : []).map(
    (d: StockChartPoint): OHLCVPoint => ({
      date: d.time,
      open: d.open ?? null,
      high: d.high ?? null,
      low: d.low ?? null,
      close: d.close ?? null,
      volume: d.volume ?? null,
      turnover: null,
    })
  )

  // Map line data for LightweightAreaChart
  const lineData = (response?.type === 'line' ? response.data : []).map((d: StockChartPoint) => ({
    time: d.time,
    value: d.value ?? 0,
  }))

  const lineVals = lineData.map(d => d.value)
  const isNeg = lineVals.length >= 2 ? lineVals[lineVals.length - 1] < lineVals[0] : false

  return (
    <div className="flex flex-col gap-4">
      {/* Range + Interval selectors */}
      <div className="flex items-center gap-1 flex-wrap">
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

      {/* Chart area */}
      {loading ? (
        <div className="h-64 flex items-center justify-center text-slate-500 text-sm animate-pulse">
          Loading...
        </div>
      ) : !response || response.data.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
          No chart data available for this range/interval
        </div>
      ) : response.type === 'ohlcv' ? (
        <CandlestickChart data={ohlcvData} height={320} />
      ) : (
        <LightweightAreaChart data={lineData} height={320} isNegative={isNeg} />
      )}
    </div>
  )
}
