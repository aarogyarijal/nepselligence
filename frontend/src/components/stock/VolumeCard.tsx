import { memo } from 'react'
import type { StockAnalysis } from '@/types/market'
import { TipLabel } from '@/components/Tooltip'
import { formatVolume } from '@/lib/format'

function VolumeCard({ volume }: { volume: StockAnalysis['volume'] }) {
  const { latest, avg20d, avg90d, volumeRatio, avgTurnover20d } = volume

  const latestPct = latest != null && avg20d != null && avg20d > 0
    ? Math.min(200, (latest / avg20d) * 100)
    : null

  const avg20Pct = avg20d != null && avg90d != null && avg90d > 0
    ? Math.min(200, (avg20d / avg90d) * 100)
    : null

  const ratioColor = volumeRatio == null ? 'text-slate-400'
    : volumeRatio > 1.5 ? 'text-green-400'
    : volumeRatio < 0.7 ? 'text-red-400'
    : 'text-yellow-400'

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">Volume</h2>
      <div className="space-y-3.5">
        <div>
          <div className="flex justify-between items-center mb-1">
            <TipLabel
              label="Today"
              tip="Total number of shares traded today. The bar shows today's volume relative to the 20-day average (bar full = 100% of average)."
              className="text-xs text-slate-500 border-slate-600"
            />
            <span className="text-sm text-slate-200">{formatVolume(latest)}</span>
          </div>
          {latestPct != null && (
            <div className="h-1.5 bg-slate-700 rounded-full">
              <div
                className={`h-1.5 rounded-full ${latestPct > 100 ? 'bg-green-500' : 'bg-slate-500'}`}
                style={{ width: `${Math.min(latestPct, 100)}%` }}
              />
            </div>
          )}
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <TipLabel
              label="20D Avg"
              tip="Average daily trading volume over the past 20 trading sessions (~1 calendar month). Used as the baseline for the volume ratio. The bar shows 20D avg relative to the 90D avg."
              className="text-xs text-slate-500 border-slate-600"
            />
            <span className="text-sm text-slate-200">{formatVolume(avg20d)}</span>
          </div>
          {avg20Pct != null && (
            <div className="h-1.5 bg-slate-700 rounded-full">
              <div
                className="h-1.5 rounded-full bg-slate-500"
                style={{ width: `${Math.min(avg20Pct, 100)}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex justify-between items-center">
          <TipLabel
            label="90D Avg"
            tip="Average daily trading volume over the past 90 trading sessions (~4 calendar months). Represents the medium-term baseline for participation in this stock."
            className="text-xs text-slate-500 border-slate-600"
          />
          <span className="text-sm text-slate-200">{formatVolume(avg90d)}</span>
        </div>

        <div className="border-t border-slate-800 pt-3">
          <div className="flex justify-between items-center">
            <TipLabel
              label="Volume Ratio"
              tip={
                <span>
                  Today&apos;s volume ÷ 20-day average volume.<br /><br />
                  <b className="text-green-400">&gt;1.5×</b>: unusually high activity (breakout or news)<br />
                  <b className="text-yellow-400">0.7–1.5×</b>: normal range<br />
                  <b className="text-red-400">&lt;0.7×</b>: low interest, thin market
                </span>
              }
              className="text-xs text-slate-500 border-slate-600"
            />
            <span className={`text-sm font-semibold ${ratioColor}`}>
              {volumeRatio != null ? `${volumeRatio.toFixed(2)}×` : '—'}
            </span>
          </div>
          <div className="flex justify-between items-center mt-2">
            <TipLabel
              label="Avg Turnover (20D)"
              tip="Average daily rupee turnover (total value of shares traded) over the past 20 sessions. Calculated as average of (volume × price) per day. Higher turnover = more liquid stock."
              className="text-xs text-slate-500 border-slate-600"
            />
            <span className="text-sm text-slate-200">Rs {formatVolume(avgTurnover20d)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(VolumeCard)
