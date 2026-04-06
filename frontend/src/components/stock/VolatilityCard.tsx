import type { StockAnalysis } from '@/types/market'

function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return `${(n * 100).toFixed(2)}%`
}

function fmt(n: number | null | undefined, prefix = '') {
  if (n == null) return '—'
  return `${prefix}${n.toFixed(2)}`
}

export default function VolatilityCard({ volatility }: { volatility: StockAnalysis['volatility'] }) {
  const { daily30d, annualized30d, avgDailyRange20d } = volatility

  const annualizedLevel = annualized30d == null ? null
    : annualized30d > 0.5 ? { label: 'High', color: 'text-red-400' }
    : annualized30d > 0.25 ? { label: 'Medium', color: 'text-yellow-400' }
    : { label: 'Low', color: 'text-green-400' }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">Volatility</h2>
      <div className="space-y-3">
        <Row label="Daily (30D)">{fmtPct(daily30d)}</Row>
        <Row label="Annualized (30D)">
          <span className="flex items-center gap-2">
            <span>{fmtPct(annualized30d)}</span>
            {annualizedLevel && (
              <span className={`text-xs font-semibold ${annualizedLevel.color}`}>
                {annualizedLevel.label}
              </span>
            )}
          </span>
        </Row>
        <div className="border-t border-slate-800 pt-3">
          <Row label="Avg Daily Range (20D)">Rs {fmt(avgDailyRange20d)}</Row>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-300">{children}</span>
    </div>
  )
}
