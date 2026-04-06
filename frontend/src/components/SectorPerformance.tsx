'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Cell, ReferenceLine,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import { fetchSectors } from '@/lib/api'
import { usePolling } from '@/hooks/usePolling'
import type { SectorData } from '@/types/market'
import type { TimeRange } from '@/app/page'

interface SectorPerformanceProps {
  isOpen: boolean
  range: TimeRange
}

const UP = '#16a34a'
const DOWN = '#dc2626'

export default function SectorPerformance({ isOpen, range }: SectorPerformanceProps) {
  const [sectors, setSectors] = useState<SectorData[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const envelope = await fetchSectors(range)
      if (envelope.data && envelope.data.length > 0) {
        setSectors([...envelope.data].sort((a, b) => b.changePct - a.changePct))
      } else {
        setSectors([])
      }
    } catch {
      setSectors([])
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { setLoading(true); load() }, [load])
  usePolling(load, 300_000, isOpen && range === '1D')

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
          contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6 }}
          labelStyle={{ color: '#f1f5f9' }}
          itemStyle={{ color: '#94a3b8' }}
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
