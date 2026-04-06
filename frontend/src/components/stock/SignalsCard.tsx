import type { StockAnalysis } from '@/types/market'
import { TipLabel } from '@/components/Tooltip'

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
        <Row
          label={
            <TipLabel
              label="Trend"
              tip={
                <span>
                  Derived from SMA alignment.<br />
                  <b className="text-green-400">Bullish</b>: price &gt; SMA20 &gt; SMA50 &gt; SMA200<br />
                  <b className="text-red-400">Bearish</b>: price &lt; SMA20 &lt; SMA50 &lt; SMA200<br />
                  <b className="text-yellow-400">Neutral</b>: mixed alignment
                </span>
              }
              className="text-slate-500 border-slate-600"
            />
          }
        >
          {trend ? (
            <span className={`flex items-center gap-1.5 font-semibold ${trend.color}`}>
              <span className={`w-2 h-2 rounded-full ${trend.dot}`} />
              {trend.label}
            </span>
          ) : <span className="text-slate-500">—</span>}
        </Row>

        <Row
          label={
            <TipLabel
              label="Momentum"
              tip={
                <span>
                  Based on RSI (14-day Relative Strength Index).<br />
                  <b className="text-red-400">Overbought</b>: RSI &gt; 70 — may be due for a pullback<br />
                  <b className="text-green-400">Oversold</b>: RSI &lt; 30 — may be due for a bounce<br />
                  <b className="text-yellow-400">Neutral</b>: RSI between 30–70
                </span>
              }
              className="text-slate-500 border-slate-600"
            />
          }
        >
          {momentum ? (
            <span className={`flex items-center gap-1.5 font-semibold ${momentum.color}`}>
              <span className={`w-2 h-2 rounded-full ${momentum.dot}`} />
              {momentum.label}
            </span>
          ) : <span className="text-slate-500">—</span>}
        </Row>

        <Row
          label={
            <TipLabel
              label="Volume"
              tip={
                <span>
                  Compares today&apos;s volume to the 20-day average.<br />
                  <b className="text-green-400">Increasing</b>: ratio &gt; 1.5× — above-average participation<br />
                  <b className="text-red-400">Decreasing</b>: ratio &lt; 0.7× — below-average participation<br />
                  <b className="text-slate-300">Stable</b>: within normal range
                </span>
              }
              className="text-slate-500 border-slate-600"
            />
          }
        >
          {volume ? (
            <span className={`font-semibold ${volume.color}`}>
              {volume.icon} {volume.label}
            </span>
          ) : <span className="text-slate-500">—</span>}
        </Row>

        <Row
          label={
            <TipLabel
              label="vs SMA"
              tip={
                <span>
                  Where the current price sits relative to key moving averages.<br />
                  <b className="text-green-400">Above All</b>: price &gt; SMA50 and SMA200<br />
                  <b className="text-yellow-400">Above 50</b>: price &gt; SMA50 but ≤ SMA200<br />
                  <b className="text-red-400">Below All</b>: price &lt; SMA50 and SMA200<br />
                  <b className="text-orange-400">Mixed</b>: inconsistent position
                </span>
              }
              className="text-slate-500 border-slate-600"
            />
          }
        >
          {sma ? (
            <span className={`font-semibold ${sma.color}`}>{sma.label}</span>
          ) : <span className="text-slate-500">—</span>}
        </Row>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}
