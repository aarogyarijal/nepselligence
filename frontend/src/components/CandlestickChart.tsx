'use client'

import { useEffect, useRef } from 'react'
import type { OHLCVPoint } from '@/types/market'

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

export default function CandlestickChart({ data, overlays = [], height = 280 }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<unknown>(null)

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    let chart: ReturnType<typeof import('lightweight-charts')['createChart']>

    const init = async () => {
      const { createChart, ColorType, LineStyle } = await import('lightweight-charts')

      if (!containerRef.current) return

      chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#94a3b8',
        },
        grid: {
          vertLines: { color: '#1e293b' },
          horzLines: { color: '#1e293b' },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#334155' },
        timeScale: { borderColor: '#334155', timeVisible: true },
        width: containerRef.current.clientWidth,
        height,
      })
      chartRef.current = chart

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#16a34a',
        downColor: '#dc2626',
        borderUpColor: '#16a34a',
        borderDownColor: '#dc2626',
        wickUpColor: '#16a34a',
        wickDownColor: '#dc2626',
      })

      const candleData = data
        .filter(d => (d.close != null || d.open != null) && d.high != null && d.low != null)
        .map(d => {
          const close = d.close ?? d.open!
          const open = d.open ?? close
          return {
            time: d.date as `${number}-${number}-${number}`,
            open,
            high: d.high!,
            low: d.low!,
            close,
          }
        })
        .sort((a, b) => a.time.localeCompare(b.time))

      candleSeries.setData(candleData)

      // Volume series in a separate pane
      const volumeSeries = chart.addHistogramSeries({
        color: '#3b82f6',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      })
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      })

      const volumeData = data
        .filter(d => d.volume != null)
        .map(d => ({
          time: d.date as `${number}-${number}-${number}`,
          value: d.volume!,
          color: '#3b82f650',
        }))
        .sort((a, b) => a.time.localeCompare(b.time))

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
        const lineData = overlay.data
          .filter(d => d.value != null)
          .map(d => ({
            time: d.date as `${number}-${number}-${number}`,
            value: d.value,
          }))
          .sort((a, b) => a.time.localeCompare(b.time))
        lineSeries.setData(lineData)
      }

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

  return <div ref={containerRef} />
}
