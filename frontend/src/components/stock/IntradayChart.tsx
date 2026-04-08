'use client'

import { useEffect, useState } from 'react'
import { fetchStockIntraday } from '@/lib/api'
import LightweightAreaChart from '@/components/LightweightAreaChart'
import type { IntradayPoint } from '@/types/market'

interface IntradayChartProps {
  symbol: string
  isOpen: boolean
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

  const chartData = data.map(d => ({ time: d.time, value: d.value }))

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
        <LightweightAreaChart data={chartData} isNegative={isNeg} />
      </div>
    </div>
  )
}
