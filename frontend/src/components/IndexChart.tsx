'use client'

import { useEffect, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { fetchIndexHistory } from '@/lib/api'
import { usePolling } from '@/hooks/usePolling'
import { formatPrice, formatChangePct, changeClass, changeArrow } from '@/lib/format'
import type { TimeRange } from '@/app/page'

interface ChartPoint {
  time: string
  value: number
  rawTime: string
}

interface IndexChartProps {
  isOpen: boolean
  range: TimeRange
}

function formatTime(isoString: string, range: TimeRange): string {
  const d = new Date(isoString)
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

export default function IndexChart({ isOpen, range }: IndexChartProps) {
  const [data, setData] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const rows = await fetchIndexHistory(range)
      if (rows && rows.length > 0) {
        setData(rows.map(r => ({
          time: formatTime(r.time, range),
          value: r.value,
          rawTime: r.time,
        })))
      } else {
        setData([])
      }
    } catch {
      setData([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [range])
  usePolling(load, 60_000, isOpen && range === '1D')

  const last = data[data.length - 1]
  const first = data[0]
  const change = data.length >= 2 ? last.value - first.value : 0
  const changePct = data.length >= 2 ? (change / first.value) * 100 : 0
  const isNegative = change < 0
  const color = isNegative ? '#dc2626' : '#16a34a'

  const chartData = data.length === 1
    ? [{ ...data[0], time: '' }, data[0]]
    : data

  const values = data.map(d => d.value)
  const minValue = values.length ? Math.min(...values) : 0
  const maxValue = values.length ? Math.max(...values) : 0
  const padding = (maxValue - minValue) * 0.1 || 1

  return (
    <div className="flex flex-col h-full">
      {/* Header: current value + change */}
      <div className="flex items-center gap-3 mb-2 shrink-0">
        {last && (
          <>
            <span className="text-2xl font-bold text-white">{formatPrice(last.value)}</span>
            {data.length >= 2 && (
              <span className={`text-sm font-medium ${changeClass(change)}`}>
                {changeArrow(change)} {formatChangePct(changePct)}
              </span>
            )}
            {data.length === 1 && (
              <span className="text-xs text-slate-500">1 snapshot — ingesting more during market hours</span>
            )}
          </>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm animate-pulse">
          Loading...
        </div>
      ) : data.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
          No index data — run Ingest Index to get started
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="nepseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
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
                domain={[minValue - padding, maxValue + padding]}
                tick={{ fontSize: 10, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => v.toFixed(0)}
                width={52}
              />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: `1px solid ${color}40`, borderRadius: 6 }}
                labelStyle={{ color: '#94a3b8', fontSize: 11 }}
                formatter={(v: number) => [v.toFixed(2), 'NEPSE']}
              />
              {data.length === 1 && (
                <ReferenceLine y={data[0].value} stroke={color} strokeDasharray="4 4" strokeOpacity={0.6} />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill="url(#nepseGrad)"
                dot={data.length === 1 ? { fill: color, r: 4 } : false}
                activeDot={{ r: 4, fill: color }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
