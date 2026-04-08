'use client'

import { useEffect, useState, useRef, memo } from 'react'
import { fetchIndexHistory } from '@/lib/api'
import { usePolling } from '@/hooks/usePolling'
import { formatPrice, formatChangePct, changeClass, changeArrow } from '@/lib/format'
import LightweightAreaChart from '@/components/LightweightAreaChart'
import type { TimeRange } from '@/app/page'
import type { TimeInterval } from '@/types/market'

interface ChartPoint {
  time: string
  value: number
}

interface IndexChartProps {
  isOpen: boolean
  range: TimeRange
  interval?: TimeInterval
}

function IndexChart({ isOpen, range, interval = '1min' }: IndexChartProps) {
  const [data, setData] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = async (signal?: AbortSignal) => {
    try {
      const rows = await fetchIndexHistory(range, interval, signal)
      if (signal?.aborted) return
      if (rows && rows.length > 0) {
        setData(rows.map(r => ({ time: r.time, value: r.value })))
      } else {
        setData([])
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setData([])
    }
  }

  useEffect(() => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    refresh(ac.signal).finally(() => {
      if (!ac.signal.aborted) setLoading(false)
    })
    return () => ac.abort()
  }, [range, interval])

  usePolling(() => refresh(), 60_000, isOpen && range === 'today')

  const last = data[data.length - 1]
  const first = data[0]
  const change = data.length >= 2 ? last.value - first.value : 0
  const changePct = data.length >= 2 ? (change / first.value) * 100 : 0
  const isNegative = change < 0

  return (
    <div className="flex flex-col h-full" suppressHydrationWarning>
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
          <LightweightAreaChart data={data} isNegative={isNegative} />
        </div>
      )}
    </div>
  )
}

export default memo(IndexChart)
