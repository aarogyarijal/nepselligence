import type { StockAnalysis } from '@/types/market'

const PERIODS = [
  { key: '1d', label: '1 Day' },
  { key: '5d', label: '5 Days' },
  { key: '1m', label: '1 Month' },
  { key: '3m', label: '3 Months' },
  { key: '6m', label: '6 Months' },
  { key: '1y', label: '1 Year' },
]

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

export default function ReturnsCard({ returns }: { returns: StockAnalysis['returns'] }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">Returns</h2>
      <div className="space-y-2.5">
        {PERIODS.map(({ key, label }) => {
          const val = returns[key] as number | null | undefined
          const isPos = val != null && val >= 0
          const isNeg = val != null && val < 0
          return (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{label}</span>
              <span className={`text-sm font-semibold tabular-nums ${
                isPos ? 'text-green-400' : isNeg ? 'text-red-400' : 'text-slate-500'
              }`}>
                {fmt(val)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
