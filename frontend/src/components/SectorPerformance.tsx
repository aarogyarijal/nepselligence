'use client'

import { useEffect, useState, useRef, memo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Cell, ReferenceLine,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts'
import { fetchSectors, fetchSectorsIntraday } from '@/lib/api'
import { CHART_COLORS, rechartsTooltipStyle } from '@/lib/chartTheme'
import { usePolling } from '@/hooks/usePolling'
import type { SectorData, IntradayPoint, TimeInterval } from '@/types/market'
import type { TimeRange } from '@/app/page'

interface SectorPerformanceProps {
  isOpen: boolean
  range: TimeRange
  interval?: TimeInterval
}

const UP = CHART_COLORS.up
const DOWN = CHART_COLORS.down

function Sparkline({ points, color }: { points: IntradayPoint[]; color: string }) {
  if (points.length < 2) return null
  return (
    <ResponsiveContainer width="100%" height={32}>
      <LineChart data={points} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function SectorPerformance({ isOpen, range, interval = '1min' }: SectorPerformanceProps) {
  const [sectors, setSectors] = useState<SectorData[]>([])
  const [intraday, setIntraday] = useState<Record<string, IntradayPoint[]>>({})
  const [loading, setLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)

    const loadSectors = async () => {
      try {
        const envelope = await fetchSectors(range)
        if (ac.signal.aborted) return
        if (envelope.data && envelope.data.length > 0) {
          setSectors([...envelope.data].sort((a, b) => b.changePct - a.changePct))
        } else {
          setSectors([])
        }
      } catch {
        if (!ac.signal.aborted) setSectors([])
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }

    const loadIntraday = async () => {
      if (interval === '1D') return
      try {
        const data = await fetchSectorsIntraday(range, interval, ac.signal)
        if (ac.signal.aborted) return
        setIntraday(data)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        if (!ac.signal.aborted) setIntraday({})
      }
    }

    loadSectors()
    loadIntraday()

    return () => ac.abort()
  }, [range, interval])

  const refreshSectors = async () => {
    try {
      const envelope = await fetchSectors(range)
      if (envelope.data && envelope.data.length > 0) {
        setSectors([...envelope.data].sort((a, b) => b.changePct - a.changePct))
      }
    } catch {}
  }

  const refreshIntraday = async () => {
    if (interval === '1D') return
    try {
      const data = await fetchSectorsIntraday(range, interval)
      setIntraday(data)
    } catch {}
  }

  usePolling(refreshSectors, 300_000, isOpen && range === 'today')
  usePolling(refreshIntraday, 60_000, isOpen && range === 'today' && interval !== '1D')

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse pt-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-4 bg-slate-700 rounded" style={{ width: `${40 + (i * 7) % 40}%` }} />
        ))}
      </div>
    )
  }

  if (sectors.length === 0) {
    return <p className="text-slate-500 text-sm text-center py-8">No sector data</p>
  }

  // Sparkline view: 1D range OR sub-daily interval on multi-day range
  if (interval !== '1D') {
    return (
      <div className="grid grid-cols-1 gap-1 overflow-y-auto h-full">
        {sectors.map(s => {
          const pts = intraday[s.name] ?? []
          const color = s.changePct >= 0 ? UP : DOWN
          const shortName = s.name.replace(' Index', '').replace('NEPSE ', '').slice(0, 22)
          return (
            <div key={s.name} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-slate-800/50 transition-colors">
              {/* Name */}
              <span className="text-slate-300 text-xs w-36 shrink-0 truncate">{shortName}</span>
              {/* Sparkline */}
              <div className="flex-1 min-w-0">
                {pts.length >= 2
                  ? <Sparkline points={pts} color={color} />
                  : <div className="h-8 flex items-center">
                      <div className="w-full h-px bg-slate-700" />
                    </div>
                }
              </div>
              {/* Change pct */}
              <span
                className="text-xs font-medium w-14 text-right shrink-0"
                style={{ color }}
              >
                {s.changePct >= 0 ? '+' : ''}{s.changePct.toFixed(2)}%
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  // interval=1D: horizontal bar chart
  const data = sectors.map(s => ({
    ...s,
    shortName: s.name.replace(' Index', '').replace('NEPSE ', '').slice(0, 18),
  }))
  const maxAbs = Math.max(...data.map(d => Math.abs(d.changePct)), 0.1)

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
      >
        <XAxis
          type="number"
          domain={[-maxAbs * 1.1, maxAbs * 1.1]}
          tickFormatter={v => `${v.toFixed(1)}%`}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="shortName"
          tick={{ fontSize: 10, fill: '#cbd5e1' }}
          width={90}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          formatter={(v: number) => [`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, 'Change']}
          {...rechartsTooltipStyle()}
        />
        <ReferenceLine x={0} stroke="#475569" />
        <Bar dataKey="changePct" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.changePct >= 0 ? UP : DOWN} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export default memo(SectorPerformance)
