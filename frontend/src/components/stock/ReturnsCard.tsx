import type { StockAnalysis } from '@/types/market'
import { TipLabel } from '@/components/Tooltip'
import { formatChangePct } from '@/lib/format'

const PERIODS = [
  {
    key: '1d', label: '1 Day',
    tip: 'Percentage change from the previous session\'s closing price to today\'s last traded price.',
  },
  {
    key: '5d', label: '5 Days',
    tip: 'Return over the past 5 trading days (roughly 1 calendar week). Compares today\'s LTP to the closing price 5 sessions ago.',
  },
  {
    key: '1m', label: '1 Month',
    tip: 'Return over the past ~30 calendar days (~22 trading sessions). Measures short-term price momentum.',
  },
  {
    key: '3m', label: '3 Months',
    tip: 'Return over the past ~90 calendar days (~66 trading sessions). A standard medium-term performance window.',
  },
  {
    key: '6m', label: '6 Months',
    tip: 'Return over the past ~180 calendar days. Captures a full market cycle phase.',
  },
  {
    key: '1y', label: '1 Year',
    tip: 'Return over the past ~365 calendar days (~220 NEPSE trading sessions). Shows full-year performance. May show — if data doesn\'t go back far enough.',
  },
]

export default function ReturnsCard({ returns }: { returns: StockAnalysis['returns'] }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">
        <TipLabel
          label="Returns"
          tip="Percentage price change over each period. Calculated as (current LTP − price N days ago) / price N days ago × 100. Uses trading-day data from the stock_prices table."
          className="text-slate-500 border-slate-600"
        />
      </h2>
      <div className="space-y-2.5">
        {PERIODS.map(({ key, label, tip }) => {
          const val = returns[key] as number | null | undefined
          return (
            <div key={key} className="flex items-center justify-between">
              <TipLabel
                label={label}
                tip={tip}
                className="text-xs text-slate-500 border-slate-600"
              />
              <span className={`text-sm font-semibold tabular-nums ${
                val == null ? 'text-slate-500' : val >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {formatChangePct(val)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
