'use client'

import { useEffect, useState, useMemo, memo, Fragment } from 'react'
import { fetchFloorsheet } from '@/lib/api'
import { formatPrice } from '@/lib/format'
import { TipLabel, Tooltip } from '@/components/Tooltip'
import type { FloorsheetRow, FloorsheetAnalytics, AnomalyType } from '@/types/market'

type Tab = 'all' | 'anomalies' | 'large'
type Range = 1 | 3 | 7 | 14 | 30
const RANGES: { key: Range; label: string }[] = [
  { key: 1, label: '1D' },
  { key: 3, label: '3D' },
  { key: 7, label: '7D' },
  { key: 14, label: '14D' },
  { key: 30, label: '30D' },
]

const ANOMALY_CONFIG: Record<AnomalyType, { label: string; color: string; bg: string; dot: string; tip: string }> = {
  volumeSpike: {
    label: 'Vol',
    color: 'text-amber-400',
    bg: 'bg-amber-500/8',
    dot: 'bg-amber-500',
    tip: 'Trade quantity is more than 2× the session median',
  },
  bigAmount: {
    label: 'Amt',
    color: 'text-violet-400',
    bg: 'bg-violet-500/8',
    dot: 'bg-violet-500',
    tip: 'Trade value is more than 2× the session average',
  },
  priceDeviation: {
    label: 'Price',
    color: 'text-red-400',
    bg: 'bg-red-500/8',
    dot: 'bg-red-500',
    tip: 'Trade rate deviates more than 2σ from session VWAP',
  },
}

function fmtCrore(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1e7) return `Rs ${(n / 1e7).toFixed(2)}Cr`
  if (n >= 1e5) return `Rs ${(n / 1e5).toFixed(1)}L`
  return `Rs ${n.toLocaleString('en-NP', { maximumFractionDigits: 0 })}`
}

/** Format time as HH:MM in NPT */
function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kathmandu',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

/** Get 10-minute bucket key like "11:00" from an ISO timestamp */
function getBucketKey(iso: string): string {
  try {
    const d = new Date(iso)
    // Convert to NPT
    const npt = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }))
    const h = npt.getHours().toString().padStart(2, '0')
    const m = (Math.floor(npt.getMinutes() / 10) * 10).toString().padStart(2, '0')
    return `${h}:${m}`
  } catch {
    return '??:??'
  }
}

/** Format bucket key to range label: "11:00 – 11:10" */
function bucketLabel(key: string): string {
  const [h, m] = key.split(':').map(Number)
  const endM = m + 10
  if (endM >= 60) {
    return `${key} – ${(h + 1).toString().padStart(2, '0')}:00`
  }
  return `${key} – ${h.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`
}

interface BucketGroup {
  key: string
  label: string
  trades: FloorsheetRow[]
  totalQty: number
  totalAmount: number
  anomalyCount: number
}

function AnalyticsBar({ analytics }: { analytics: FloorsheetAnalytics }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 bg-slate-800/50 border-b border-slate-700 text-xs">
      <span className="text-slate-400">
        <TipLabel label="VWAP" tip="Volume-weighted average price across all trades in this session" className="text-slate-400 border-slate-600" />
        {' '}<span className="text-slate-200 font-semibold tabular-nums">Rs {formatPrice(analytics.vwap)}</span>
      </span>
      <span className="text-slate-400">
        Trades <span className="text-slate-200 tabular-nums">{analytics.totalTrades.toLocaleString()}</span>
      </span>
      <span className="text-slate-400">
        Volume <span className="text-slate-200 tabular-nums">{analytics.totalVolume.toLocaleString('en-IN')}</span>
      </span>
      <span className="text-slate-400">
        Turnover <span className="text-slate-200 tabular-nums">{fmtCrore(analytics.totalTurnover)}</span>
      </span>
      <span className="text-slate-400">
        Median <span className="text-slate-200 tabular-nums">{analytics.medianTradeSize.toLocaleString('en-IN')} shr</span>
      </span>
      {analytics.priceRange && (
        <span className="text-slate-400">
          Range <span className="text-slate-200 tabular-nums">{formatPrice(analytics.priceRange.low)} – {formatPrice(analytics.priceRange.high)}</span>
        </span>
      )}
    </div>
  )
}

function AnomalyBadges({ anomalies }: { anomalies: AnomalyType[] }) {
  if (!anomalies.length) return null
  return (
    <span className="inline-flex gap-1">
      {anomalies.map(a => {
        const cfg = ANOMALY_CONFIG[a]
        return (
          <Tooltip key={a} content={cfg.tip}>
            <span
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium cursor-help ${cfg.color} bg-slate-800`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
          </Tooltip>
        )
      })}
    </span>
  )
}

function BucketHeader({ bucket }: { bucket: BucketGroup }) {
  const hasAnomalies = bucket.anomalyCount > 0
  return (
    <tr className={`bg-slate-800/80 ${hasAnomalies ? 'border-l-2 border-l-amber-500/50' : ''}`}>
      <td colSpan={7} className="px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-300">{bucket.label}</span>
            <span className="text-xs text-slate-500">{bucket.trades.length} trades</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>Vol <span className="text-slate-400 tabular-nums">{bucket.totalQty.toLocaleString('en-IN')}</span></span>
            <span>Amt <span className="text-slate-400 tabular-nums">{fmtCrore(bucket.totalAmount)}</span></span>
            {hasAnomalies && (
              <span className="text-amber-400">{bucket.anomalyCount} anomal{bucket.anomalyCount === 1 ? 'y' : 'ies'}</span>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

function FloorsheetTimeline({ symbol }: { symbol: string }) {
  const [trades, setTrades] = useState<FloorsheetRow[]>([])
  const [analytics, setAnalytics] = useState<FloorsheetAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [days, setDays] = useState<Range>(1)

  useEffect(() => {
    if (!symbol) return
    setLoading(true)
    fetchFloorsheet(symbol, 5000, days)
      .then(data => {
        setTrades(data.trades)
        setAnalytics(data.analytics)
      })
      .catch(() => {})  // keep whatever is showing rather than an unhandled rejection
      .finally(() => setLoading(false))
  }, [symbol, days])

  // Filter trades by tab
  const filtered = useMemo(() => {
    if (tab === 'anomalies') return trades.filter(t => t.anomalies.length > 0)
    if (tab === 'large') {
      const threshold = analytics?.medianTradeSize ? analytics.medianTradeSize * 3 : 5000
      return trades.filter(t => t.quantity >= threshold)
    }
    return trades
  }, [trades, tab, analytics])

  // Group into 10-minute buckets (trades come newest-first, reverse for chronological)
  const buckets = useMemo(() => {
    const chronological = [...filtered].reverse()
    const map = new Map<string, FloorsheetRow[]>()
    for (const t of chronological) {
      const key = getBucketKey(t.time)
      const arr = map.get(key)
      if (arr) arr.push(t)
      else map.set(key, [t])
    }
    const groups: BucketGroup[] = []
    for (const [key, trades] of map) {
      groups.push({
        key,
        label: bucketLabel(key),
        trades,
        totalQty: trades.reduce((s, t) => s + t.quantity, 0),
        totalAmount: trades.reduce((s, t) => s + t.amount, 0),
        anomalyCount: trades.filter(t => t.anomalies.length > 0).length,
      })
    }
    return groups
  }, [filtered])

  const anomalyCount = useMemo(() => trades.filter(t => t.anomalies.length > 0).length, [trades])

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-xl">
        <div className="px-5 py-4 border-b border-slate-700">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Floorsheet Timeline</h2>
        </div>
        <div className="flex items-center justify-center h-40 text-slate-400 text-sm animate-pulse">
          Loading trades…
        </div>
      </div>
    )
  }

  if (!trades.length) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-xl">
        <div className="px-5 py-4 border-b border-slate-700">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Floorsheet Timeline</h2>
        </div>
        <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
          No floorsheet data available
        </div>
      </div>
    )
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            <TipLabel
              label="Floorsheet Timeline"
              tip="Every individual contract from the NEPSE floorsheet, grouped by 10-minute windows. Trades with unusual volume, amount, or price deviation are flagged as anomalies."
              className="text-slate-500 border-slate-600"
            />
          </h2>
          {/* Tab switcher */}
          <div className="flex gap-1">
            {([
              { key: 'all' as Tab, label: `All (${trades.length})` },
              { key: 'anomalies' as Tab, label: `Anomalies (${anomalyCount})` },
              { key: 'large' as Tab, label: 'Large Only' },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                  tab === t.key
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {/* Range selector */}
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setDays(r.key)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                days === r.key
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Analytics bar */}
      {analytics && <AnalyticsBar analytics={analytics} />}

      {/* Anomaly legend */}
      <div className="flex items-center gap-4 px-5 py-2 border-b border-slate-800 text-[10px]">
        {(Object.entries(ANOMALY_CONFIG) as [AnomalyType, typeof ANOMALY_CONFIG[AnomalyType]][]).map(([key, cfg]) => (
          <span key={key} className="flex items-center gap-1 text-slate-500">
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            <span className={cfg.color}>{cfg.label}</span>
            <span>— {cfg.tip.split(' more than ')[0].replace('Trade ', '')}</span>
          </span>
        ))}
      </div>

      {/* Trade table */}
      <div className="overflow-y-auto max-h-[600px] flex-1">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
            {tab === 'anomalies' ? 'No anomalous trades detected' : 'No large trades found'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-800 text-slate-400 z-10">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Time</th>
                <th className="px-4 py-2 text-left font-medium">Buyer</th>
                <th className="px-4 py-2 text-left font-medium">Seller</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 text-right font-medium">Rate</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-left font-medium">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {buckets.map(bucket => (
                <Fragment key={bucket.key}>
                  <BucketHeader bucket={bucket} />
                  {bucket.trades.map(row => {
                    const hasAnomaly = row.anomalies.length > 0
                    // Pick the most severe anomaly bg
                    const rowBg = hasAnomaly
                      ? row.anomalies.includes('priceDeviation')
                        ? 'bg-red-500/5'
                        : row.anomalies.includes('bigAmount')
                          ? 'bg-violet-500/5'
                          : 'bg-amber-500/5'
                      : ''
                    return (
                      <tr
                        key={row.contractNo}
                        className={`transition-colors hover:bg-slate-800/50 ${rowBg}`}
                      >
                        <td className="px-4 py-1.5 text-slate-500 tabular-nums">{fmtTime(row.time)}</td>
                        <td className="px-4 py-1.5 text-green-400/70 font-medium truncate max-w-[100px]">{row.buyer}</td>
                        <td className="px-4 py-1.5 text-red-400/70 font-medium truncate max-w-[100px]">{row.seller}</td>
                        <td className={`px-4 py-1.5 text-right tabular-nums ${hasAnomaly && row.anomalies.includes('volumeSpike') ? 'text-amber-400 font-semibold' : 'text-slate-300'}`}>
                          {row.quantity.toLocaleString('en-IN')}
                        </td>
                        <td className={`px-4 py-1.5 text-right tabular-nums ${hasAnomaly && row.anomalies.includes('priceDeviation') ? 'text-red-400 font-semibold' : 'text-slate-300'}`}>
                          {formatPrice(row.rate)}
                        </td>
                        <td className={`px-4 py-1.5 text-right tabular-nums ${hasAnomaly && row.anomalies.includes('bigAmount') ? 'text-violet-400 font-semibold' : 'text-slate-400'}`}>
                          {fmtCrore(row.amount)}
                        </td>
                        <td className="px-4 py-1.5">
                          <AnomalyBadges anomalies={row.anomalies} />
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {filtered.length > 0 && (
        <div className="px-5 py-2.5 border-t border-slate-700 text-xs text-slate-500 shrink-0 flex items-center justify-between">
          <span>{filtered.length} trades · {buckets.length} time windows</span>
          {anomalyCount > 0 && tab === 'all' && (
            <span className="text-amber-500/70">{anomalyCount} anomalous trade{anomalyCount !== 1 ? 's' : ''} detected</span>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(FloorsheetTimeline)
