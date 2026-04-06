'use client'
import { memo } from 'react'
import type { StockAnalysis } from '@/types/market'
import { TipLabel } from '@/components/Tooltip'
import { formatPrice } from '@/lib/format'

function StockHeader({ analysis }: { analysis: StockAnalysis }) {
  const { symbol, name, sector, price } = analysis
  const isPositive = (price.change ?? 0) >= 0

  const rangePos = price.rangePosition ?? 0
  const pct52w = Math.round(rangePos * 100)

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white">{symbol}</h1>
            {sector && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-700 text-slate-300">
                {sector}
              </span>
            )}
          </div>
          {name && <p className="text-slate-400 text-sm">{name}</p>}
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-white">
            <TipLabel
              label={`Rs ${formatPrice(price.ltp)}`}
              tip="Last Traded Price — the most recent price at which this stock changed hands on NEPSE."
              className="text-white font-bold border-slate-700"
            />
          </div>
          <div className={`text-sm font-semibold mt-0.5 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {isPositive ? '▲' : '▼'}{' '}
            <TipLabel
              label={`${formatPrice(Math.abs(price.change ?? 0))} (${isPositive ? '+' : ''}${formatPrice(price.changePct ?? 0)}%)`}
              tip="Change from previous close. Absolute rupee change and percentage change since the last trading session's closing price."
              className={`${isPositive ? 'border-green-700' : 'border-red-700'} font-semibold`}
            />
          </div>
          {price.prevClose != null && (
            <div className="text-xs text-slate-500 mt-0.5">
              <TipLabel
                label={`Prev close: Rs ${formatPrice(price.prevClose)}`}
                tip="Previous session's closing price. Used as the baseline for today's change calculation."
                className="text-slate-500 border-slate-700"
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-2">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <TipLabel
            label={`52W Low: Rs ${formatPrice(price.low52w)}`}
            tip="52-week low — the lowest price this stock traded at over the past 52 weeks (approximately 1 year of trading data)."
            className="text-slate-500 border-slate-700"
          />
          <TipLabel
            label="52-Week Range"
            tip="The white dot shows where today's price sits within the past year's high-low range. Far right = near yearly high. Far left = near yearly low."
            className="text-slate-400 font-medium border-slate-600"
          />
          <TipLabel
            label={`52W High: Rs ${formatPrice(price.high52w)}`}
            tip="52-week high — the highest price this stock traded at over the past 52 weeks."
            className="text-slate-500 border-slate-700"
          />
        </div>
        <div className="relative h-2 bg-slate-700 rounded-full">
          <div
            className="absolute top-0 h-2 bg-slate-500 rounded-full"
            style={{ width: `${pct52w}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-slate-400 shadow"
            style={{ left: `calc(${pct52w}% - 6px)` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-500 mt-1">
          <span />
          <TipLabel
            label={`ATH: Rs ${formatPrice(price.allTimeHigh)}`}
            tip="All-Time High — the highest price ever recorded for this stock in the available dataset (220 days of backfill data)."
            className="text-slate-400 border-slate-600"
          />
        </div>
      </div>
    </div>
  )
}

export default memo(StockHeader)
