// Shared chart theme for lightweight-charts and recharts components

import { chartTimeFormatters } from './nptTime'

export const CHART_COLORS = {
  up: '#16a34a',
  down: '#dc2626',
  neutral: '#3b82f6',
  text: '#94a3b8',
  textBright: '#e2e8f0',
  grid: '#1e293b',
  border: '#334155',
  bg: 'transparent',
  tooltipBg: '#0f172a',
  volumeUp: 'rgba(22, 163, 74, 0.35)',
  volumeDown: 'rgba(220, 38, 38, 0.35)',
} as const

/**
 * lightweight-charts ChartOptions partial (typed loosely to avoid importing at module scope).
 * `realTime` maps a collapsed-axis timestamp back to the real one, when session gaps were collapsed.
 */
export function lwcChartOptions(height: number, realTime?: (t: number) => number) {
  // Labels are always NPT, whatever the viewer's timezone
  const { tickMarkFormatter, timeFormatter } = chartTimeFormatters(realTime)
  return {
    layout: {
      background: { type: 'solid' as const, color: CHART_COLORS.bg },
      textColor: CHART_COLORS.text,
    },
    grid: {
      vertLines: { color: CHART_COLORS.grid },
      horzLines: { color: CHART_COLORS.grid },
    },
    crosshair: { mode: 0 },
    // A vertical finger drag scrolls the page instead of being swallowed by the chart
    handleScroll: { vertTouchDrag: false },
    rightPriceScale: { borderColor: CHART_COLORS.border },
    timeScale: { borderColor: CHART_COLORS.border, timeVisible: true, tickMarkFormatter },
    localization: { timeFormatter },
    height,
  }
}

export const CANDLE_SERIES_OPTIONS = {
  upColor: CHART_COLORS.up,
  downColor: CHART_COLORS.down,
  borderUpColor: CHART_COLORS.up,
  borderDownColor: CHART_COLORS.down,
  wickUpColor: CHART_COLORS.up,
  wickDownColor: CHART_COLORS.down,
}

export function areaSeriesOptions(isNegative: boolean) {
  const color = isNegative ? CHART_COLORS.down : CHART_COLORS.up
  return {
    lineColor: color,
    lineWidth: 2 as const,
    topColor: color + '40',
    bottomColor: color + '05',
    crosshairMarkerRadius: 4,
    crosshairMarkerBackgroundColor: color,
  }
}

export function rechartsTooltipStyle(accentColor?: string) {
  return {
    contentStyle: {
      background: CHART_COLORS.tooltipBg,
      border: `1px solid ${accentColor ? accentColor + '40' : CHART_COLORS.border}`,
      borderRadius: 6,
    },
    labelStyle: { color: CHART_COLORS.textBright, fontSize: 11 },
    itemStyle: { color: CHART_COLORS.text },
  }
}
