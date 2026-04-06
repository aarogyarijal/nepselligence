import { memo } from 'react'
import type { StockAnalysis } from '@/types/market'
import { TipLabel } from '@/components/Tooltip'
import { formatChangePct } from '@/lib/format'

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

function RelPerfCard({ relativePerformance }: { relativePerformance: StockAnalysis['relativePerformance'] }) {
  if (!relativePerformance) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">
          <TipLabel
            label="vs NEPSE (30D)"
            tip="Compares this stock's 30-day return against the NEPSE index return over the same period. Requires at least two NEPSE index data points 30 days apart."
            className="text-slate-500 border-slate-600"
          />
        </h2>
        <p className="text-xs text-slate-500">Insufficient NEPSE index data</p>
      </div>
    )
  }

  const { stockReturn30d, nepseReturn30d, alpha30d } = relativePerformance
  const maxAbs = Math.max(Math.abs(stockReturn30d ?? 0), Math.abs(nepseReturn30d ?? 0), 1)
  const alphaPos = (alpha30d ?? 0) >= 0

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">
        <TipLabel
          label="vs NEPSE (30D)"
          tip="Compares this stock's 30-day return to the NEPSE composite index return over the same window. Shows whether the stock is beating or lagging the broader market."
          className="text-slate-500 border-slate-600"
        />
      </h2>
      <div className="space-y-3">
        <div>
          <div className="flex justify-between items-center mb-1">
            <TipLabel
              label="Stock Return"
              tip="This stock's percentage price change over the past 30 trading days. Calculated as (LTP today − close 30 sessions ago) / close 30 sessions ago × 100."
              className="text-xs text-slate-500 border-slate-600"
            />
            <span className={`text-sm font-semibold tabular-nums ${(stockReturn30d ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatChangePct(stockReturn30d)}
            </span>
          </div>
          {stockReturn30d != null && <RetBar value={stockReturn30d} max={maxAbs} />}
        </div>

        <div>
          <div className="flex justify-between items-center mb-1">
            <TipLabel
              label="NEPSE Return"
              tip="The NEPSE composite index percentage change over the same 30-day window. Sourced from the market_summary table. Used as the market benchmark."
              className="text-xs text-slate-500 border-slate-600"
            />
            <span className={`text-sm font-semibold tabular-nums ${(nepseReturn30d ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatChangePct(nepseReturn30d)}
            </span>
          </div>
          {nepseReturn30d != null && <RetBar value={nepseReturn30d} max={maxAbs} />}
        </div>

        <div className="border-t border-slate-800 pt-3">
          <div className="flex justify-between items-center">
            <TipLabel
              label="Alpha"
              tip={
                <span>
                  Stock Return − NEPSE Return over 30 days.<br /><br />
                  <b className="text-green-400">Positive alpha</b>: this stock beat the market — it generated returns above what the index delivered.<br />
                  <b className="text-red-400">Negative alpha</b>: the stock lagged the market — you&apos;d have done better holding an index fund.
                </span>
              }
              className="text-xs text-slate-500 border-slate-600"
            />
            <span className={`text-sm font-bold tabular-nums ${alphaPos ? 'text-green-400' : 'text-red-400'}`}>
              {formatChangePct(alpha30d)}
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

export default memo(RelPerfCard)
