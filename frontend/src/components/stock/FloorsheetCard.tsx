import { memo } from 'react'
import type { StockAnalysis } from '@/types/market'
import { TipLabel } from '@/components/Tooltip'

function fmt(n: number | null | undefined, decimals = 0) {
  if (n == null) return '—'
  return n.toLocaleString('en-NP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtCrore(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1e7) return `Rs ${(n / 1e7).toFixed(2)}Cr`
  if (n >= 1e5) return `Rs ${(n / 1e5).toFixed(1)}L`
  return `Rs ${fmt(n)}`
}

const BUCKET_COLORS: Record<string, string> = {
  micro:  'bg-slate-600',
  small:  'bg-blue-700',
  medium: 'bg-indigo-600',
  large:  'bg-violet-600',
  block:  'bg-amber-500',
}

const BUCKET_ORDER = ['micro', 'small', 'medium', 'large', 'block']

function SizeDistBar({
  dist,
  totalTrades,
  totalTurnover,
}: {
  dist: { bucket: string; trades: number; turnover: number }[]
  totalTrades: number
  totalTurnover: number
}) {
  if (!dist.length) return null
  const sorted = BUCKET_ORDER.map(b => dist.find(d => d.bucket === b)).filter(Boolean) as typeof dist

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 h-4">
        {sorted.map(d => {
          const pct = (d.trades / Math.max(totalTrades, 1)) * 100
          return pct > 0 ? (
            <div
              key={d.bucket}
              className={`h-full rounded-sm ${BUCKET_COLORS[d.bucket] ?? 'bg-slate-600'}`}
              style={{ width: `${pct}%` }}
              title={`${d.bucket}: ${d.trades} trades (${pct.toFixed(1)}%)`}
            />
          ) : null
        })}
      </div>
      <div className="flex items-center gap-1 h-3">
        {sorted.map(d => {
          const pct = (d.turnover / Math.max(totalTurnover, 1)) * 100
          return pct > 0 ? (
            <div
              key={d.bucket}
              className={`h-full rounded-sm opacity-60 ${BUCKET_COLORS[d.bucket] ?? 'bg-slate-600'}`}
              style={{ width: `${pct}%` }}
              title={`${d.bucket}: ${fmtCrore(d.turnover)} (${pct.toFixed(1)}% of turnover)`}
            />
          ) : null
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {sorted.map(d => (
          <div key={d.bucket} className="flex items-center gap-1 text-xs text-slate-400">
            <span className={`inline-block w-2 h-2 rounded-sm ${BUCKET_COLORS[d.bucket] ?? 'bg-slate-600'}`} />
            <span className="capitalize">{d.bucket}</span>
            <span className="text-slate-500">
              {fmt((d.trades / Math.max(totalTrades, 1)) * 100, 0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FloorsheetCard({ floorsheet }: { floorsheet: StockAnalysis['floorsheet'] }) {
  if (!floorsheet) return null

  const {
    vwap, avgTradeSize, medianTradeSize, totalTrades,
    totalTurnover, blockTrades, sizeDistribution,
  } = floorsheet

  const blockPct = blockTrades && totalTurnover
    ? ((blockTrades.turnover / Math.max(totalTurnover, 1)) * 100).toFixed(1)
    : null

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          <TipLabel
            label="Floorsheet (7D)"
            tip="Trade-level analytics from the NEPSE floorsheet over the last 7 days. Includes VWAP, trade size distribution (micro/small/medium/large/block), and block trade detection. Broker identity is not disclosed by NEPSE."
            className="text-slate-500 border-slate-600"
          />
        </h2>
        <span className="text-xs text-slate-500 tabular-nums">{fmt(totalTrades)} trades</span>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <TipLabel
            label="VWAP"
            tip="Volume Weighted Average Price — average price weighted by trade volume over the last 7 days."
            className="text-xs text-slate-500 border-slate-600"
          />
          <p className="text-sm font-semibold text-slate-200 tabular-nums mt-1">Rs {fmt(vwap, 2)}</p>
        </div>
        <div>
          <TipLabel
            label="Avg / Median"
            tip="Average vs median trade size (shares). A large gap means a few big trades are skewing the average — sign of block activity."
            className="text-xs text-slate-500 border-slate-600"
          />
          <p className="text-sm font-semibold text-slate-200 tabular-nums mt-1">
            {fmt(avgTradeSize)} <span className="text-slate-500 text-xs">/ {fmt(medianTradeSize)}</span>
          </p>
        </div>
        <div>
          <TipLabel
            label="Turnover"
            tip="Total trade value over the last 7 days from floorsheet data."
            className="text-xs text-slate-500 border-slate-600"
          />
          <p className="text-sm font-semibold text-slate-200 tabular-nums mt-1">{fmtCrore(totalTurnover)}</p>
        </div>
      </div>

      {/* Trade size distribution */}
      {sizeDistribution && sizeDistribution.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-slate-500 mb-2">
            <TipLabel
              label="Trade Size Distribution"
              tip="Top bar = % of trades by count. Bottom bar = % of turnover. Block trades (>10K shares) dominating turnover may indicate institutional activity."
              className="text-slate-500 border-slate-600"
            />
          </p>
          <SizeDistBar
            dist={sizeDistribution}
            totalTrades={totalTrades}
            totalTurnover={totalTurnover ?? 1}
          />
        </div>
      )}

      {/* Block trade section */}
      {blockTrades && blockTrades.count > 0 && (
        <div className="border-t border-slate-800 pt-3 flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
            <span className="text-slate-400">Block trades</span>
          </div>
          <span className="text-amber-400 font-semibold tabular-nums">{blockTrades.count}</span>
          <span className="text-slate-500">{fmtCrore(blockTrades.turnover)}</span>
          {blockPct && (
            <span className="text-slate-500">({blockPct}% of turnover)</span>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(FloorsheetCard)
