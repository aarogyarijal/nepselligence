'use client'

import type { StockAnalysis } from '@/types/market'

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-NP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export default function StockHeader({ analysis }: { analysis: StockAnalysis }) {
  const { symbol, name, sector, price } = analysis
  const isPositive = (price.change ?? 0) >= 0

  const rangePos = price.rangePosition ?? 0
  const pct52w = Math.round(rangePos * 100)

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6">
      {/* Name row */}
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
          <div className="text-3xl font-bold text-white">Rs {fmt(price.ltp)}</div>
          <div className={`text-sm font-semibold mt-0.5 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {isPositive ? '▲' : '▼'} {fmt(Math.abs(price.change ?? 0))} ({isPositive ? '+' : ''}{fmt(price.changePct)}%)
          </div>
          {price.prevClose != null && (
            <div className="text-xs text-slate-500 mt-0.5">Prev close: Rs {fmt(price.prevClose)}</div>
          )}
        </div>
      </div>

      {/* 52-week range bar */}
      <div className="mt-2">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>52W Low: Rs {fmt(price.low52w)}</span>
          <span className="text-slate-400 font-medium">52-Week Range</span>
          <span>52W High: Rs {fmt(price.high52w)}</span>
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
          <span className="text-slate-400">ATH: Rs {fmt(price.allTimeHigh)}</span>
        </div>
      </div>
    </div>
  )
}
