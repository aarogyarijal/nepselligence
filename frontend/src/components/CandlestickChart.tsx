'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import type { OHLCVPoint } from '@/types/market'
import { CHART_COLORS, lwcChartOptions, CANDLE_SERIES_OPTIONS } from '@/lib/chartTheme'
import { formatPrice, formatVolume, toNPTUnix, NPT_OFFSET_SECONDS } from '@/lib/format'
import { collapseSessionGaps } from '@/lib/chartUtils'

export interface ChartOverlay {
  label: string
  data: { date: string; value: number }[]
  color: string
  dashed?: boolean
}

interface CandlestickChartProps {
  data: OHLCVPoint[]
  overlays?: ChartOverlay[]
  height?: number
  /** When set, the visible range starts at this date instead of showing all data */
  visibleFrom?: string
}

interface OHLCLegend {
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

/** Convert a date/time string to the format lightweight-charts expects:
 *  - ISO strings with 'T' → UTC timestamp (seconds)
 *  - Plain date strings (YYYY-MM-DD) → business day string
 */
function toLWCTime(dateStr: string): string | number {
  if (dateStr.includes('T')) {
    return toNPTUnix(dateStr)
  }
  return dateStr.slice(0, 10)
}

function sortByTime<T extends { time: string | number }>(arr: T[]): T[] {
  return arr.sort((a, b) => {
    if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time
    return String(a.time).localeCompare(String(b.time))
  })
}


export default function CandlestickChart({ data, overlays = [], height, visibleFrom }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<unknown>(null)
  const [legend, setLegend] = useState<OHLCLegend | null>(null)

  const candleCountRef = useRef<number>(0)

  // Stable references: memoize data/overlays so chart doesn't destroy/recreate on parent re-renders
  const stableData = useMemo(() => data, [JSON.stringify(data)])
  const stableOverlays = useMemo(() => overlays, [JSON.stringify(overlays)])

  useEffect(() => {
    if (!containerRef.current || stableData.length === 0) return

    // Set default legend to last candle
    const lastD = stableData[stableData.length - 1]
    if (lastD) {
      setLegend({
        open: lastD.open ?? lastD.close ?? 0,
        high: lastD.high ?? 0,
        low: lastD.low ?? 0,
        close: lastD.close ?? lastD.open ?? 0,
        volume: lastD.volume,
      })
    }

    let chart: ReturnType<typeof import('lightweight-charts')['createChart']>

    const init = async () => {
      const { createChart, ColorType, LineStyle } = await import('lightweight-charts')

      if (!containerRef.current) return

      const containerHeight = height ?? containerRef.current.clientHeight ?? 280

      // Build raw candle data with numeric times
      const rawCandleData = sortByTime(
        stableData
          .filter(d => (d.close != null || d.open != null) && d.high != null && d.low != null)
          .map(d => {
            const close = d.close ?? d.open!
            const open = d.open ?? close
            return {
              time: toLWCTime(d.date) as number & string,
              open,
              high: d.high!,
              low: d.low!,
              close,
            }
          })
      )

      // Build raw volume data
      const rawVolumeData = sortByTime(
        stableData
          .filter(d => d.volume != null)
          .map(d => {
            const close = d.close ?? d.open ?? 0
            const open = d.open ?? close
            return {
              time: toLWCTime(d.date) as number & string,
              value: d.volume!,
              color: close >= open ? CHART_COLORS.volumeUp : CHART_COLORS.volumeDown,
            }
          })
      )

      // Collapse overnight/weekend gaps for intraday multi-day data
      const gapResult = collapseSessionGaps(rawCandleData as Array<{ time: number; [k: string]: unknown }>)
      let timeMap: Map<number, number> | null = null

      let candleData = rawCandleData
      let volumeData = rawVolumeData

      if (gapResult) {
        timeMap = gapResult.timeMap
        candleData = gapResult.collapsed as typeof rawCandleData

        // Apply same mapping to volume data
        const volGapResult = collapseSessionGaps(rawVolumeData as Array<{ time: number; [k: string]: unknown }>)
        if (volGapResult) {
          volumeData = volGapResult.collapsed as typeof rawVolumeData
        }
      }

      // Format real time from a virtual timestamp for axis labels
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
        // Override time scale to use real-time labels on collapsed axis
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
      chartRef.current = chart

      const candleSeries = chart.addCandlestickSeries(CANDLE_SERIES_OPTIONS)
      candleSeries.setData(candleData as Parameters<typeof candleSeries.setData>[0])

      // Volume series — colored green/red matching candle direction
      const volumeSeries = chart.addHistogramSeries({
        color: CHART_COLORS.neutral,
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      })
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      })
      volumeSeries.setData(volumeData as Parameters<typeof volumeSeries.setData>[0])

      // Overlay line series (SMA, Bollinger, etc.)
      for (const overlay of stableOverlays) {
        const lineSeries = chart.addLineSeries({
          color: overlay.color,
          lineWidth: 1,
          lineStyle: overlay.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        let lineItems = sortByTime(
          overlay.data
            .filter(d => d.value != null)
            .map(d => ({
              time: toLWCTime(d.date) as `${number}-${number}-${number}`,
              value: d.value,
            }))
        )
        // Collapse overlay gaps too if main data was collapsed
        if (timeMap) {
          const overlayGap = collapseSessionGaps(lineItems as unknown as Array<{ time: number; [k: string]: unknown }>)
          if (overlayGap) lineItems = overlayGap.collapsed as unknown as typeof lineItems
        }
        lineSeries.setData(lineItems)
      }

      // OHLC legend on crosshair move
      chart.subscribeCrosshairMove(param => {
        if (!param.time || !param.seriesData) {
          // Reset to last candle when crosshair leaves
          const last = candleData[candleData.length - 1]
          const lastVol = volumeData[volumeData.length - 1]
          if (last) {
            setLegend({
              open: last.open,
              high: last.high,
              low: last.low,
              close: last.close,
              volume: lastVol?.value ?? null,
            })
          }
          return
        }
        const candle = param.seriesData.get(candleSeries) as {
          open?: number; high?: number; low?: number; close?: number
        } | undefined
        const vol = param.seriesData.get(volumeSeries) as { value?: number } | undefined
        if (candle && candle.open != null) {
          setLegend({
            open: candle.open!,
            high: candle.high!,
            low: candle.low!,
            close: candle.close!,
            volume: vol?.value ?? null,
          })
        }
      })

      candleCountRef.current = candleData.length

      // Set initial visible range
      if (visibleFrom && candleData.length > 0) {
        // Find the index of the first candle at or after visibleFrom
        const fromTime = toLWCTime(visibleFrom)
        let fromIdx = candleData.findIndex(c => {
          if (typeof c.time === 'number' && typeof fromTime === 'number') return c.time >= fromTime
          return String(c.time) >= String(fromTime)
        })
        if (fromIdx < 0) fromIdx = 0
        chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: candleData.length - 1 })
      } else {
        chart.timeScale().fitContent()
      }

      // Resize observer — always track width; track height when no explicit height prop
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
  }, [stableData, stableOverlays, height])

  // Adjust visible range when visibleFrom changes (without recreating chart)
  useEffect(() => {
    const chart = chartRef.current as { timeScale(): { setVisibleLogicalRange(r: { from: number; to: number }): void; fitContent(): void } } | null
    if (!chart || candleCountRef.current === 0) return

    if (visibleFrom) {
      // Re-derive candle data to find index — use the same sorted data approach
      const sorted = stableData
        .filter(d => (d.close != null || d.open != null) && d.high != null && d.low != null)
        .map(d => ({ time: toLWCTime(d.date) }))
        .sort((a, b) => {
          if (typeof a.time === 'number' && typeof b.time === 'number') return a.time - b.time
          return String(a.time).localeCompare(String(b.time))
        })

      const fromTime = toLWCTime(visibleFrom)
      let fromIdx = sorted.findIndex(c => {
        if (typeof c.time === 'number' && typeof fromTime === 'number') return c.time >= fromTime
        return String(c.time) >= String(fromTime)
      })
      if (fromIdx < 0) fromIdx = 0
      chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: sorted.length - 1 })
    } else {
      chart.timeScale().fitContent()
    }
  }, [visibleFrom, stableData])

  const legendColor = legend && legend.close >= legend.open ? CHART_COLORS.up : CHART_COLORS.down

  return (
    <div className={`relative ${height == null ? 'h-full' : ''}`}>
      {legend && (
        <div className="absolute top-1 left-1 z-10 flex gap-3 text-xs font-mono pointer-events-none">
          <span className="text-slate-500">O <span className="text-slate-300">{formatPrice(legend.open)}</span></span>
          <span className="text-slate-500">H <span className="text-slate-300">{formatPrice(legend.high)}</span></span>
          <span className="text-slate-500">L <span className="text-slate-300">{formatPrice(legend.low)}</span></span>
          <span className="text-slate-500">C <span style={{ color: legendColor }}>{formatPrice(legend.close)}</span></span>
          {legend.volume != null && (
            <span className="text-slate-500">Vol <span className="text-slate-300">{formatVolume(legend.volume)}</span></span>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        style={height != null ? { height } : undefined}
        className={height == null ? 'w-full h-full' : 'w-full'}
      />
    </div>
  )
}
