'use client'

import { useEffect, useState, useRef, useMemo, memo } from 'react'
import { fetchIndexHistory } from '@/lib/api'
import { usePolling } from '@/hooks/usePolling'
import { formatPrice, formatChangePct, changeClass, changeArrow } from '@/lib/format'
import LightweightAreaChart from '@/components/LightweightAreaChart'
import type { TimeRange } from '@/app/page'
import type { TimeInterval } from '@/types/market'
import { dailyRangeStart } from '@/lib/nptTime'

interface ChartPoint {
  time: string
  value: number
}

interface IndexChartProps {
  isOpen: boolean
  range: TimeRange
  interval?: TimeInterval
}

/** Daily ranges that can be served from preloaded 1Y data */
const DAILY_RANGES = new Set<TimeRange>(['5D', '1M', '3M', '6M', '1Y'])

function IndexChart({ isOpen, range, interval = '1min' }: IndexChartProps) {
  // Preloaded 1Y daily data (fetched once)
  const [dailyData, setDailyData] = useState<ChartPoint[]>([])
  const [dailyLoading, setDailyLoading] = useState(true)
  // Intraday data (fetched on demand for today/last_day)
  const [intradayData, setIntradayData] = useState<ChartPoint[]>([])
  const [intradayLoading, setIntradayLoading] = useState(true)
  const abortRef = useRef<AbortController | null>(null)

  const isDailyRange = DAILY_RANGES.has(range)

  // Preload 1Y daily data once
  useEffect(() => {
    const ac = new AbortController()
    setDailyLoading(true)
    fetchIndexHistory('1Y', '1D', ac.signal)
      .then(rows => {
        if (!ac.signal.aborted) setDailyData(rows?.length ? rows.map(r => ({ time: r.time, value: r.value })) : [])
      })
      .catch(() => { if (!ac.signal.aborted) setDailyData([]) })
      .finally(() => { if (!ac.signal.aborted) setDailyLoading(false) })
    return () => ac.abort()
  }, [])

  // Fetch intraday data only for today/last_day
  const refreshIntraday = async (signal?: AbortSignal) => {
    try {
      const rows = await fetchIndexHistory(range, interval, signal)
      if (signal?.aborted) return
      setIntradayData(rows?.length ? rows.map(r => ({ time: r.time, value: r.value })) : [])
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setIntradayData([])
    }
  }

  useEffect(() => {
    if (isDailyRange) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setIntradayLoading(true)
    refreshIntraday(ac.signal).finally(() => {
      if (!ac.signal.aborted) setIntradayLoading(false)
    })
    return () => ac.abort()
  }, [range, interval, isDailyRange])

  usePolling(() => refreshIntraday(), 60_000, isOpen && range === 'today')

  const data = isDailyRange ? dailyData : intradayData
  const loading = isDailyRange ? dailyLoading : intradayLoading

  const visibleFrom = useMemo(() => {
    if (!isDailyRange) return undefined
    return dailyRangeStart(range) || undefined
  }, [range, isDailyRange])

  const last = data[data.length - 1]
  const first = data[0]

  // For daily ranges with visibleFrom, compute change from the visible start
  const visibleFirst = useMemo(() => {
    if (!visibleFrom || !isDailyRange || data.length === 0) return first
    const found = data.find(d => d.time.slice(0, 10) >= visibleFrom)
    return found ?? first
  }, [data, visibleFrom, isDailyRange, first])

  const change = data.length >= 2 && visibleFirst && last ? last.value - visibleFirst.value : 0
  const changePct = data.length >= 2 && visibleFirst ? (change / visibleFirst.value) * 100 : 0
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
          <LightweightAreaChart data={data} isNegative={isNegative} visibleFrom={visibleFrom} />
        </div>
      )}
    </div>
  )
}

export default memo(IndexChart)
