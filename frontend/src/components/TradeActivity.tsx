'use client'

import { useState, useEffect } from 'react'
import { fetchMarketFloorsheetSummary } from '@/lib/api'
import type { MarketFloorsheetSummary } from '@/types/market'
import WidgetShell from './WidgetShell'

function fmtCrore(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`
  return n.toLocaleString('en-NP', { maximumFractionDigits: 0 })
}

const BUCKET_COLORS: Record<string, string> = {
  micro:  'bg-slate-600',
  small:  'bg-blue-700',
  medium: 'bg-indigo-600',
  large:  'bg-violet-600',
  block:  'bg-amber-500',
}

/** This card always covers one trading day, whatever range is selected: "Today" or that day's date */
function dayLabel(date: string | null | undefined): string | undefined {
  if (!date) return undefined
  const day = date.slice(0, 10)
  const todayNPT = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' })
  if (day === todayNPT) return 'Today'
  const d = new Date(`${day}T00:00:00Z`)
  if (isNaN(d.getTime())) return undefined
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const BUCKET_ORDER = ['micro', 'small', 'medium', 'large', 'block']

type ActiveView = 'turnover' | 'trades' | 'blocks'

export default function TradeActivity() {
  const [data, setData] = useState<MarketFloorsheetSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ActiveView>('turnover')

  useEffect(() => {
    fetchMarketFloorsheetSummary()
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <WidgetShell title="Trade Activity" loading>{null}</WidgetShell>
  }

  if (!data || data.totalTrades === 0) {
    return (
      <WidgetShell title="Trade Activity" empty emptyMessage="No floorsheet data today">{null}</WidgetShell>
    )
  }

  const sortedProfile = BUCKET_ORDER
    .map(b => data.tradeSizeProfile.find(p => p.bucket === b))
    .filter(Boolean) as MarketFloorsheetSummary['tradeSizeProfile']

  const listItems =
    view === 'turnover' ? data.topByTurnover :
    view === 'trades'   ? data.topByTrades :
    data.blockLeaders.map(b => ({
      symbol: b.symbol,
      trades: b.blockCount,
      turnover: b.blockTurnover,
      vwap: undefined,
      blockCount: b.blockCount,
      blockPct: b.blockPct,
    }))

  return (
    <WidgetShell title="Trade Activity" period={dayLabel(data.date)}>
      <div className="space-y-3">
        {/* Summary line */}
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {data.totalTrades.toLocaleString()} trades ·{' '}
            <span className="text-slate-400">Rs {fmtCrore(data.totalTurnover)} turnover</span>
          </span>
        </div>

        {/* Trade size distribution bar */}
        {sortedProfile.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-0.5 h-2.5 rounded overflow-hidden">
              {sortedProfile.map(p => p.tradePct > 0 ? (
                <div
                  key={p.bucket}
                  className={`h-full ${BUCKET_COLORS[p.bucket] ?? 'bg-slate-600'}`}
                  style={{ width: `${p.tradePct}%` }}
                  title={`${p.bucket}: ${p.tradePct}% of trades`}
                />
              ) : null)}
            </div>
            <div className="flex gap-x-2 gap-y-0.5 flex-wrap">
              {sortedProfile.map(p => (
                <span key={p.bucket} className="flex items-center gap-1 text-xs text-slate-500">
                  <span className={`inline-block w-1.5 h-1.5 rounded-sm ${BUCKET_COLORS[p.bucket] ?? 'bg-slate-600'}`} />
                  <span className="capitalize">{p.bucket}</span>
                  <span className="text-slate-600">{p.tradePct}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex gap-1 border-b border-slate-800 pb-1">
          {([
            { key: 'turnover', label: 'By Turnover' },
            { key: 'trades',   label: 'By Trades' },
            { key: 'blocks',   label: `Blocks (${data.blockLeaders.length})` },
          ] as { key: ActiveView; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                view === t.key
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="space-y-1">
          {listItems.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-2">No block trade data</p>
          ) : listItems.slice(0, 5).map((item, i) => {
            const isBlock = view === 'blocks'
            return (
              <div key={item.symbol} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-slate-600 tabular-nums text-right">{i + 1}</span>
                <span className="flex-1 text-slate-300 font-medium">{item.symbol}</span>
                {isBlock ? (
                  <>
                    <span className="text-amber-400 tabular-nums">
                      {(item as { trades: number }).trades} blocks
                    </span>
                    <span className="text-slate-500 tabular-nums w-16 text-right">
                      {(item as { blockPct?: number }).blockPct?.toFixed(1)}%
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-slate-400 tabular-nums">
                      {(item as { trades: number }).trades.toLocaleString()}
                    </span>
                    <span className="text-slate-500 tabular-nums w-16 text-right">
                      {fmtCrore((item as { turnover: number }).turnover)}
                    </span>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </WidgetShell>
  )
}
