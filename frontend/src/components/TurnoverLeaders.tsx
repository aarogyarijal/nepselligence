'use client'

import { useEffect, useState, useCallback, memo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { fetchTopTurnover } from '@/lib/api'
import { usePolling } from '@/hooks/usePolling'
import type { TurnoverLeader } from '@/types/market'
import type { TimeRange } from '@/app/page'

interface TurnoverLeadersProps {
  isOpen: boolean
  range: TimeRange
  onSymbolClick: (symbol: string) => void
  onFloorsheetClick?: (symbol: string) => void
}

function TurnoverLeaders({ isOpen, range, onSymbolClick, onFloorsheetClick }: TurnoverLeadersProps) {
  const [leaders, setLeaders] = useState<TurnoverLeader[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const envelope = await fetchTopTurnover(range)
      setLeaders(envelope.data ? envelope.data.slice(0, 10) : [])
    } catch {
      setLeaders([])
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { setLoading(true); load() }, [load])
  usePolling(load, 30_000, isOpen && range === '1D')

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 bg-slate-700 rounded" />
        ))}
      </div>
    )
  }

  if (leaders.length === 0) {
    return <p className="text-slate-500 text-sm text-center py-8">No turnover data</p>
  }

  const data = leaders.map(l => ({
    ...l,
    turnoverCr: l.turnover / 1_00_00_000,
  }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
        onClick={(e) => {
          if (e?.activePayload?.[0]) {
            const sym = e.activePayload[0].payload.symbol
            if (onFloorsheetClick) {
              onFloorsheetClick(sym)
            } else {
              onSymbolClick(sym)
            }
          }
        }}
      >
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          tickFormatter={v => `${v.toFixed(0)} Cr`}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="symbol"
          tick={{ fontSize: 11, fill: '#e2e8f0', cursor: 'pointer' }}
          width={60}
          axisLine={false}
          tickLine={false}
          onClick={(data) => { if (data?.value) onSymbolClick(String(data.value)) }}
        />
        <Tooltip
          formatter={(v: number) => [`Rs ${v.toFixed(2)} Cr`, 'Turnover']}
          contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6 }}
          labelStyle={{ color: '#f1f5f9' }}
          itemStyle={{ color: '#94a3b8' }}
        />
        <Bar dataKey="turnoverCr" radius={[0, 4, 4, 0]} isAnimationActive={false} cursor="pointer">
          {data.map((_, i) => (
            <Cell key={i} fill="#3b82f6" fillOpacity={0.7 + (1 - i / data.length) * 0.3} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export default memo(TurnoverLeaders)
