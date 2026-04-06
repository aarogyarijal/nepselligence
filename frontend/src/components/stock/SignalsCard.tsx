import type { StockAnalysis } from '@/types/market'

const TREND_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  bullish: { label: 'Bullish', color: 'text-green-400', dot: 'bg-green-400' },
  bearish: { label: 'Bearish', color: 'text-red-400', dot: 'bg-red-400' },
  neutral: { label: 'Neutral', color: 'text-yellow-400', dot: 'bg-yellow-400' },
}

const MOMENTUM_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  overbought: { label: 'Overbought', color: 'text-red-400', dot: 'bg-red-400' },
  oversold: { label: 'Oversold', color: 'text-green-400', dot: 'bg-green-400' },
  neutral: { label: 'Neutral', color: 'text-yellow-400', dot: 'bg-yellow-400' },
}

const VOLUME_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  increasing: { label: 'Increasing', color: 'text-green-400', icon: '↑' },
  decreasing: { label: 'Decreasing', color: 'text-red-400', icon: '↓' },
  stable: { label: 'Stable', color: 'text-slate-400', icon: '→' },
}

const SMA_CONFIG: Record<string, { label: string; color: string }> = {
  above_all: { label: 'Above All', color: 'text-green-400' },
  above_50: { label: 'Above 50', color: 'text-yellow-400' },
  below_all: { label: 'Below All', color: 'text-red-400' },
  mixed: { label: 'Mixed', color: 'text-orange-400' },
  above_50_only: { label: 'Above 50', color: 'text-yellow-400' },
  below_50: { label: 'Below 50', color: 'text-red-400' },
}

export default function SignalsCard({ signals }: { signals: StockAnalysis['signals'] }) {
  const trend = signals.trend ? TREND_CONFIG[signals.trend] : null
  const momentum = signals.momentum ? MOMENTUM_CONFIG[signals.momentum] : null
  const volume = signals.volumeTrend ? VOLUME_CONFIG[signals.volumeTrend] : null
  const sma = signals.priceVsSMA ? SMA_CONFIG[signals.priceVsSMA] : null

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">Signals</h2>
      <div className="space-y-3">
        <Row label="Trend">
          {trend ? (
            <span className={`flex items-center gap-1.5 font-semibold ${trend.color}`}>
              <span className={`w-2 h-2 rounded-full ${trend.dot}`} />
              {trend.label}
            </span>
          ) : <span className="text-slate-500">—</span>}
        </Row>
        <Row label="Momentum">
          {momentum ? (
            <span className={`flex items-center gap-1.5 font-semibold ${momentum.color}`}>
              <span className={`w-2 h-2 rounded-full ${momentum.dot}`} />
              {momentum.label}
            </span>
          ) : <span className="text-slate-500">—</span>}
        </Row>
        <Row label="Volume">
          {volume ? (
            <span className={`font-semibold ${volume.color}`}>
              {volume.icon} {volume.label}
            </span>
          ) : <span className="text-slate-500">—</span>}
        </Row>
        <Row label="vs SMA">
          {sma ? (
            <span className={`font-semibold ${sma.color}`}>{sma.label}</span>
          ) : <span className="text-slate-500">—</span>}
        </Row>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}
