import type { StockAnalysis } from '@/types/market'

function fmtRet(n: number | null | undefined) {
  if (n == null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function RetBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.abs(value) / max * 100)
  const isPos = value >= 0
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full relative">
        <div
          className={`absolute top-0 h-1.5 rounded-full ${isPos ? 'bg-green-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function RelPerfCard({ relativePerformance }: { relativePerformance: StockAnalysis['relativePerformance'] }) {
  if (!relativePerformance) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">vs NEPSE (30D)</h2>
        <p className="text-xs text-slate-500">Insufficient data</p>
      </div>
    )
  }

  const { stockReturn30d, nepseReturn30d, alpha30d } = relativePerformance
  const maxAbs = Math.max(Math.abs(stockReturn30d ?? 0), Math.abs(nepseReturn30d ?? 0), 1)
  const alphaPos = (alpha30d ?? 0) >= 0

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">vs NEPSE (30D)</h2>
      <div className="space-y-3">
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-slate-500">Stock Return</span>
            <span className={`text-sm font-semibold tabular-nums ${(stockReturn30d ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {fmtRet(stockReturn30d)}
            </span>
          </div>
          {stockReturn30d != null && <RetBar value={stockReturn30d} max={maxAbs} />}
        </div>
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-slate-500">NEPSE Return</span>
            <span className={`text-sm font-semibold tabular-nums ${(nepseReturn30d ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {fmtRet(nepseReturn30d)}
            </span>
          </div>
          {nepseReturn30d != null && <RetBar value={nepseReturn30d} max={maxAbs} />}
        </div>
        <div className="border-t border-slate-800 pt-3">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Alpha</span>
            <span className={`text-sm font-bold tabular-nums ${alphaPos ? 'text-green-400' : 'text-red-400'}`}>
              {fmtRet(alpha30d)}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            {alpha30d != null
              ? alphaPos
                ? `Outperforming NEPSE by ${Math.abs(alpha30d).toFixed(2)}%`
                : `Underperforming NEPSE by ${Math.abs(alpha30d).toFixed(2)}%`
              : ''}
          </p>
        </div>
      </div>
    </div>
  )
}
