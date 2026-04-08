'use client'

import { useEffect, useRef, useState } from 'react'
import type { OHLCVPoint } from '@/types/market'
import { CHART_COLORS, lwcChartOptions, CANDLE_SERIES_OPTIONS } from '@/lib/chartTheme'
import { formatPrice, formatVolume, toNPTUnix } from '@/lib/format'

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

export default function CandlestickChart({ data, overlays = [], height = 280 }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<unknown>(null)
  const [legend, setLegend] = useState<OHLCLegend | null>(null)

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    // Set default legend to last candle
    const lastD = data[data.length - 1]
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

      chart = createChart(containerRef.current, {
        ...lwcChartOptions(height),
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: CHART_COLORS.text,
        },
        width: containerRef.current.clientWidth,
      })
      chartRef.current = chart

      const candleSeries = chart.addCandlestickSeries(CANDLE_SERIES_OPTIONS)

      const candleData = sortByTime(
        data
          .filter(d => (d.close != null || d.open != null) && d.high != null && d.low != null)
          .map(d => {
            const close = d.close ?? d.open!
            const open = d.open ?? close
            return {
              time: toLWCTime(d.date) as `${number}-${number}-${number}`,
              open,
              high: d.high!,
              low: d.low!,
              close,
            }
          })
      )

      candleSeries.setData(candleData)

      // Volume series — colored green/red matching candle direction
      const volumeSeries = chart.addHistogramSeries({
        color: CHART_COLORS.neutral,
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      })
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      })

      const volumeData = sortByTime(
        data
          .filter(d => d.volume != null)
          .map(d => {
            const close = d.close ?? d.open ?? 0
            const open = d.open ?? close
            return {
              time: toLWCTime(d.date) as `${number}-${number}-${number}`,
              value: d.volume!,
              color: close >= open ? CHART_COLORS.volumeUp : CHART_COLORS.volumeDown,
            }
          })
      )

      volumeSeries.setData(volumeData)

      // Overlay line series (SMA, Bollinger, etc.)
      for (const overlay of overlays) {
        const lineSeries = chart.addLineSeries({
          color: overlay.color,
          lineWidth: 1,
          lineStyle: overlay.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        const lineData = sortByTime(
          overlay.data
            .filter(d => d.value != null)
            .map(d => ({
              time: toLWCTime(d.date) as `${number}-${number}-${number}`,
              value: d.value,
            }))
        )
        lineSeries.setData(lineData)
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

      chart.timeScale().fitContent()

      // Resize observer
      const ro = new ResizeObserver(entries => {
        if (entries[0] && chart) {
          chart.applyOptions({ width: entries[0].contentRect.width })
        }
      })
      ro.observe(containerRef.current)

      return () => {
        ro.disconnect()
        chart.remove()
      }
    }

    let cleanup: (() => void) | undefined
    init().then(fn => { cleanup = fn })

    return () => {
      cleanup?.()
    }
  }, [data, overlays, height])

  const legendColor = legend && legend.close >= legend.open ? CHART_COLORS.up : CHART_COLORS.down

  return (
    <div className="relative">
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
      <div ref={containerRef} />
    </div>
  )
}
