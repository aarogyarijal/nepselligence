import type { StockAnalysis } from '@/types/market'

function fmt(n: number | null | undefined, decimals = 0) {
  if (n == null) return '—'
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(2)} Cr`
  if (n >= 100_000) return `${(n / 100_000).toFixed(2)} L`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString('en-NP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export default function VolumeCard({ volume }: { volume: StockAnalysis['volume'] }) {
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
            <span className="text-xs text-slate-500">Today</span>
            <span className="text-sm text-slate-200">{fmt(latest)}</span>
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
            <span className="text-xs text-slate-500">20D Avg</span>
            <span className="text-sm text-slate-200">{fmt(avg20d)}</span>
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
          <span className="text-xs text-slate-500">90D Avg</span>
          <span className="text-sm text-slate-200">{fmt(avg90d)}</span>
        </div>

        <div className="border-t border-slate-800 pt-3">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Volume Ratio</span>
            <span className={`text-sm font-semibold ${ratioColor}`}>
              {volumeRatio != null ? `${volumeRatio.toFixed(2)}x` : '—'}
            </span>
          </div>
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-slate-500">Avg Turnover (20D)</span>
            <span className="text-sm text-slate-200">Rs {fmt(avgTurnover20d)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
