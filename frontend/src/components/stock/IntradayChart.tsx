'use client'

import { useEffect, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { fetchStockIntraday } from '@/lib/api'
import type { IntradayPoint } from '@/types/market'

interface IntradayChartProps {
  symbol: string
  isOpen: boolean
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Kathmandu',
  })
}

export default function IntradayChart({ symbol, isOpen }: IntradayChartProps) {
  const [data, setData] = useState<IntradayPoint[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const pts = await fetchStockIntraday(symbol)
      setData(pts && pts.length > 0 ? pts : [])
    } catch {
      setData([])
    }
  }

  useEffect(() => {
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [symbol])

  // Poll every 60s while market is open
  useEffect(() => {
    if (!isOpen) return
    const id = setInterval(refresh, 60_000)
    return () => clearInterval(id)
  }, [isOpen, symbol])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm animate-pulse">
        Loading intraday...
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        No intraday data — available during market hours
      </div>
    )
  }

  const last = data[data.length - 1]
  const change = last.change
  const changePct = last.changePct
  const isNeg = change < 0
  const color = isNeg ? '#dc2626' : '#16a34a'

  const values = data.map(d => d.value)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const pad = (maxVal - minVal) * 0.08 || 1

  const chartData = data.map(d => ({ ...d, time: fmtTime(d.time) }))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <span className="text-lg font-bold text-white">{last.value.toFixed(2)}</span>
        <span className="text-sm font-medium" style={{ color }}>
          {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
        </span>
        <span className="text-xs text-slate-500 ml-auto">{data.length} ticks</span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`intradayGrad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={color} stopOpacity={0.01} />
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
              domain={[minVal - pad, maxVal + pad]}
              tick={{ fontSize: 10, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v.toFixed(0)}
              width={52}
            />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: `1px solid ${color}40`, borderRadius: 6 }}
              labelStyle={{ color: '#94a3b8', fontSize: 11 }}
              formatter={(v: number) => [v.toFixed(2), 'Price']}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#intradayGrad-${symbol})`}
              dot={false}
              activeDot={{ r: 3, fill: color }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
