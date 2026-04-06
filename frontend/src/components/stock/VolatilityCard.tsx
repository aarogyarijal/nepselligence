import { memo } from 'react'
import type { StockAnalysis } from '@/types/market'
import { TipLabel } from '@/components/Tooltip'
import { formatPct, formatPrice } from '@/lib/format'

function VolatilityCard({ volatility }: { volatility: StockAnalysis['volatility'] }) {
  const { daily30d, annualized30d, avgDailyRange20d } = volatility

  const annualizedLevel = annualized30d == null ? null
    : annualized30d > 0.5 ? { label: 'High', color: 'text-red-400' }
    : annualized30d > 0.25 ? { label: 'Medium', color: 'text-yellow-400' }
    : { label: 'Low', color: 'text-green-400' }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">
        <TipLabel
          label="Volatility"
          tip="Measures how much this stock's price fluctuates. Higher volatility = bigger swings in both directions. Calculated from the standard deviation of daily log-returns."
          className="text-slate-500 border-slate-600"
        />
      </h2>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <TipLabel
            label="Daily (30D)"
            tip={
              <span>
                Standard deviation of daily returns over the past 30 trading sessions.<br /><br />
                Formula: σ of [(price_t / price_t−1) − 1] for each day.<br /><br />
                A value of 2% means the stock typically moves ±2% per day.
              </span>
            }
            className="text-xs text-slate-500 border-slate-600"
          />
          <span className="text-sm text-slate-300">{formatPct(daily30d)}</span>
        </div>

        <div className="flex items-center justify-between">
          <TipLabel
            label="Annualized (30D)"
            tip={
              <span>
                Daily volatility scaled to a yearly figure.<br /><br />
                Formula: daily_vol × √220 (NEPSE has ~220 trading days/year).<br /><br />
                <b className="text-green-400">Low</b>: &lt;25% · <b className="text-yellow-400">Medium</b>: 25–50% · <b className="text-red-400">High</b>: &gt;50%<br /><br />
                For context: NEPSE blue chips typically run 20–40% annualized.
              </span>
            }
            className="text-xs text-slate-500 border-slate-600"
          />
          <span className="flex items-center gap-2 text-sm text-slate-300">
            <span>{formatPct(annualized30d)}</span>
            {annualizedLevel && (
              <span className={`text-xs font-semibold ${annualizedLevel.color}`}>
                {annualizedLevel.label}
              </span>
            )}
          </span>
        </div>

        <div className="border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between">
            <TipLabel
              label="Avg Daily Range (20D)"
              tip={
                <span>
                  Average of (High − Low) over the past 20 trading sessions, in rupees.<br /><br />
                  Shows the typical intraday price swing. Useful for setting realistic profit targets and stop-loss levels.
                </span>
              }
              className="text-xs text-slate-500 border-slate-600"
            />
            <span className="text-sm text-slate-300">Rs {formatPrice(avgDailyRange20d)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(VolatilityCard)
