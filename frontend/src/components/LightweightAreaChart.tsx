'use client'

import { useEffect, useRef, useMemo } from 'react'
import { CHART_COLORS, lwcChartOptions, areaSeriesOptions } from '@/lib/chartTheme'
import { toNPTUnix, NPT_OFFSET_SECONDS } from '@/lib/format'
import { collapseSessionGaps } from '@/lib/chartUtils'

interface LightweightAreaChartProps {
  data: { time: string; value: number }[]
  height?: number
  isNegative?: boolean
  /** When set, the visible range starts at this date instead of showing all data */
  visibleFrom?: string
}

export default function LightweightAreaChart({
  data,
  height,
  isNegative = false,
  visibleFrom,
}: LightweightAreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<unknown>(null)
  const pointCountRef = useRef<number>(0)
  const stableData = useMemo(() => data, [JSON.stringify(data)])

  useEffect(() => {
    if (!containerRef.current || stableData.length === 0) return

    let chart: ReturnType<typeof import('lightweight-charts')['createChart']>

    const init = async () => {
      const { createChart, ColorType, LineStyle } = await import('lightweight-charts')

      if (!containerRef.current) return

      const containerHeight = height ?? containerRef.current.clientHeight ?? 200

      // Determine time format: ISO with 'T' → UTC seconds, otherwise business day string
      const isIntraday = stableData.some(d => d.time.includes('T'))

      let chartData = stableData
        .map(d => {
          if (isIntraday) {
            return {
              time: (toNPTUnix(d.time)) as unknown as string,
              value: d.value,
            }
          }
          // Daily data: extract YYYY-MM-DD
          const dateStr = d.time.length >= 10 ? d.time.slice(0, 10) : d.time
          return { time: dateStr, value: d.value }
        })
        .sort((a, b) => {
          if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time
          return String(a.time).localeCompare(String(b.time))
        })

      // Collapse overnight/weekend gaps for multi-day intraday data
      let timeMap: Map<number, number> | null = null
      if (isIntraday) {
        const gapResult = collapseSessionGaps(chartData as unknown as Array<{ time: number; [k: string]: unknown }>)
        if (gapResult) {
          chartData = gapResult.collapsed as unknown as typeof chartData
          timeMap = gapResult.timeMap
        }
      }

      const formatRealTime = (virtualTs: number): string => {
        const realTs = timeMap?.get(virtualTs) ?? virtualTs
        const d = new Date((realTs - NPT_OFFSET_SECONDS) * 1000)
        const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'Asia/Kathmandu' })
        const day = d.toLocaleString('en-US', { day: 'numeric', timeZone: 'Asia/Kathmandu' })
        const hour = d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kathmandu' })
        return `${day} ${month} ${hour}`
      }

      const chartOpts = lwcChartOptions(containerHeight)
      if (timeMap) {
        chartOpts.timeScale = {
          ...chartOpts.timeScale,
          tickMarkFormatter: (time: number) => formatRealTime(time),
        } as typeof chartOpts.timeScale
      }

      chart = createChart(containerRef.current, {
        ...chartOpts,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: CHART_COLORS.text,
        },
        width: containerRef.current.clientWidth,
      })

      const areaSeries = chart.addAreaSeries(areaSeriesOptions(isNegative))
      areaSeries.setData(chartData as Parameters<typeof areaSeries.setData>[0])

      // Single-point: add a dashed price line
      if (stableData.length === 1) {
        const color = isNegative ? CHART_COLORS.down : CHART_COLORS.up
        areaSeries.createPriceLine({
          price: stableData[0].value,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
        })
      }

      chartRef.current = chart
      pointCountRef.current = chartData.length

      // Set initial visible range
      if (visibleFrom && chartData.length > 0) {
        const fromTime = isIntraday ? toNPTUnix(visibleFrom) : visibleFrom.slice(0, 10)
        let fromIdx = chartData.findIndex(c => {
          if (typeof c.time === 'number' && typeof fromTime === 'number') return (c.time as unknown as number) >= fromTime
          return String(c.time) >= String(fromTime)
        })
        if (fromIdx < 0) fromIdx = 0
        chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: chartData.length - 1 })
      } else {
        chart.timeScale().fitContent()
      }

      // Resize observer for both width and height
      const ro = new ResizeObserver(entries => {
        if (entries[0] && chart) {
          const { width, height: h } = entries[0].contentRect
          chart.applyOptions({
            width,
            ...(height == null ? { height: h } : {}),
          })
        }
      })
      ro.observe(containerRef.current)

      return () => {
        ro.disconnect()
        // Drop the ref first: touching a removed chart throws "Object is disposed" on its next paint
        if (chartRef.current === chart) chartRef.current = null
        chart.remove()
      }
    }

    let cleanup: (() => void) | undefined
    let cancelled = false
    // If the effect was torn down while init was still loading, dispose the chart as soon as it exists
    init().then(fn => { if (cancelled) fn?.(); else cleanup = fn })

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [stableData, height, isNegative])

  // Adjust visible range when visibleFrom changes (without recreating chart)
  useEffect(() => {
    const chart = chartRef.current as { timeScale(): { setVisibleLogicalRange(r: { from: number; to: number }): void; fitContent(): void } } | null
    if (!chart || pointCountRef.current === 0) return

    if (visibleFrom) {
      const isIntraday = stableData.some(d => d.time.includes('T'))
      const sorted = stableData
        .map(d => ({ time: isIntraday ? toNPTUnix(d.time) : d.time.slice(0, 10) }))
        .sort((a, b) => {
          if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time
          return String(a.time).localeCompare(String(b.time))
        })

      const fromTime = isIntraday ? toNPTUnix(visibleFrom) : visibleFrom.slice(0, 10)
      let fromIdx = sorted.findIndex(c => {
        if (typeof c.time === 'number' && typeof fromTime === 'number') return (c.time as unknown as number) >= fromTime
        return String(c.time) >= String(fromTime)
      })
      if (fromIdx < 0) fromIdx = 0
      chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: sorted.length - 1 })
    } else {
      chart.timeScale().fitContent()
    }
  }, [visibleFrom, stableData])

  return (
    <div
      ref={containerRef}
      style={height != null ? { height } : undefined}
      className={height == null ? 'w-full h-full' : 'w-full'}
    />
  )
}
