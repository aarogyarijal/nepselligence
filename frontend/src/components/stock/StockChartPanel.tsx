'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
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

/** Daily ranges that can be served from preloaded 1Y data */
const DAILY_RANGES = new Set<TimeRange>(['5D', '1M', '3M', '6M', '1Y'])

/** Compute the start date for a daily range relative to today */
function dailyRangeStart(r: TimeRange): string {
  const d = new Date()
  switch (r) {
    case '5D':  d.setDate(d.getDate() - 5); break
    case '1M':  d.setMonth(d.getMonth() - 1); break
    case '3M':  d.setMonth(d.getMonth() - 3); break
    case '6M':  d.setMonth(d.getMonth() - 6); break
    case '1Y':  // fall through — show all
    default:    return ''
  }
  return d.toISOString().slice(0, 10)
}

interface StockChartPanelProps {
  symbol: string
  chartHeight?: number
}

export default function StockChartPanel({ symbol, chartHeight }: StockChartPanelProps) {
  const [range, setRange] = useState<TimeRange>('today')
  const [interval, setInterval] = useState<TimeInterval>('1min')
  // Preloaded 1Y daily data (fetched once per symbol)
  const [dailyResponse, setDailyResponse] = useState<StockChartResponse | null>(null)
  const [dailyLoading, setDailyLoading] = useState(true)
  // Intraday data (fetched on demand for today/last_day)
  const [intradayResponse, setIntradayResponse] = useState<StockChartResponse | null>(null)
  const [intradayLoading, setIntradayLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const isDailyRange = DAILY_RANGES.has(range)

  // Preload 1Y daily data once per symbol
  useEffect(() => {
    const ac = new AbortController()
    setDailyLoading(true)
    fetchStockChart(symbol, '1Y', '1D', ac.signal)
      .then(data => { if (!ac.signal.aborted) setDailyResponse(data) })
      .catch(() => { if (!ac.signal.aborted) setDailyResponse(null) })
      .finally(() => { if (!ac.signal.aborted) setDailyLoading(false) })
    return () => ac.abort()
  }, [symbol])

  // Fetch intraday data only for today/last_day ranges
  useEffect(() => {
    if (isDailyRange) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setIntradayLoading(true)
    fetchStockChart(symbol, range, interval, ac.signal)
      .then(data => { if (!ac.signal.aborted) setIntradayResponse(data) })
      .catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (!ac.signal.aborted) setIntradayResponse(null)
      })
      .finally(() => { if (!ac.signal.aborted) setIntradayLoading(false) })

    return () => ac.abort()
  }, [symbol, range, interval, isDailyRange])

  const handleRangeChange = (r: TimeRange) => {
    setRange(r)
    if (!DAILY_RANGES.has(r)) {
      const valid = VALID_INTERVALS[r]
      if (!valid.includes(interval)) setInterval(DEFAULT_INTERVAL[r])
    }
  }

  // Active response depends on range type
  const response = isDailyRange ? dailyResponse : intradayResponse
  const loading = isDailyRange ? dailyLoading : intradayLoading

  // For daily ranges, compute visibleFrom so the chart zooms without refetching
  const visibleFrom = useMemo(() => {
    if (!isDailyRange) return undefined
    return dailyRangeStart(range) || undefined
  }, [range, isDailyRange])

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
        {!isDailyRange && (
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

      {/* Chart area */}
      <div style={chartHeight ? { height: chartHeight } : { height: 320 }}>
        {loading ? (
          <div className="h-full flex items-center justify-center text-slate-500 text-sm animate-pulse">
            Loading...
          </div>
        ) : !response || response.data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-500 text-sm">
            No chart data available for this range/interval
          </div>
        ) : response.type === 'ohlcv' ? (
          <CandlestickChart data={ohlcvData} visibleFrom={visibleFrom} />
        ) : (
          <LightweightAreaChart data={lineData} isNegative={isNeg} />
        )}
      </div>
    </div>
  )
}
