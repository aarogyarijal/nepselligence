'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import CandlestickChart from '@/components/CandlestickChart'
import { fetchStockChart } from '@/lib/api'
import type { TimeInterval, StockChartResponse, StockChartPoint, OHLCVPoint } from '@/types/market'
import { VALID_INTERVALS, DEFAULT_INTERVAL } from '@/types/market'
import type { TimeRange } from '@/app/page'

const RANGES: TimeRange[] = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y']

interface StockChartPanelProps {
  symbol: string
}

function formatTime(isoString: string, range: TimeRange, interval: TimeInterval): string {
  const d = new Date(isoString)
  if (interval === '1D') {
    return d.toLocaleDateString('en-IN', {
      month: 'short', day: 'numeric',
      timeZone: 'Asia/Kathmandu',
    })
  }
  if (range === '1D') {
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'Asia/Kathmandu',
    })
  }
  return d.toLocaleDateString('en-IN', {
    month: 'short', day: 'numeric',
    timeZone: 'Asia/Kathmandu',
  })
}

export default function StockChartPanel({ symbol }: StockChartPanelProps) {
  const [range, setRange] = useState<TimeRange>('1D')
  const [interval, setInterval] = useState<TimeInterval>('1min')
  const [response, setResponse] = useState<StockChartResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const handleRangeChange = (r: TimeRange) => {
    setRange(r)
    const valid = VALID_INTERVALS[r]
    if (!valid.includes(interval)) setInterval(DEFAULT_INTERVAL[r])
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchStockChart(symbol, range, interval)
      setResponse(data)
    } catch {
      setResponse(null)
    } finally {
      setLoading(false)
    }
  }, [symbol, range, interval])

  useEffect(() => { load() }, [load])

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

  // Map line data for AreaChart
  const lineData = (response?.type === 'line' ? response.data : []).map((d: StockChartPoint) => ({
    time: formatTime(d.time, range, interval),
    value: d.value ?? 0,
    rawTime: d.time,
  }))

  const lineVals = lineData.map(d => d.value)
  const minV = lineVals.length ? Math.min(...lineVals) : 0
  const maxV = lineVals.length ? Math.max(...lineVals) : 0
  const padding = (maxV - minV) * 0.1 || 1

  const lastLine = lineData[lineData.length - 1]
  const firstLine = lineData[0]
  const lineChange = lineData.length >= 2 ? lastLine.value - firstLine.value : 0
  const isNeg = lineChange < 0
  const lineColor = isNeg ? '#dc2626' : '#16a34a'

  const chartLineData = lineData.length === 1
    ? [{ ...lineData[0], time: '' }, lineData[0]]
    : lineData

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
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartLineData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="stockGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={lineColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={lineColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[minV - padding, maxV + padding]}
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => v.toFixed(2)}
                width={60}
              />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: `1px solid ${lineColor}40`, borderRadius: 6 }}
                labelStyle={{ color: '#94a3b8', fontSize: 11 }}
                formatter={(v: number) => [v.toFixed(2), symbol]}
              />
              {lineData.length === 1 && (
                <ReferenceLine y={lineData[0].value} stroke={lineColor} strokeDasharray="4 4" strokeOpacity={0.6} />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={2}
                fill="url(#stockGrad)"
                dot={lineData.length === 1 ? { fill: lineColor, r: 4 } : false}
                activeDot={{ r: 4, fill: lineColor }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
