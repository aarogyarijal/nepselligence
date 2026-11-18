'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { fetchFloorsheet } from '@/lib/api'
import { formatPrice, formatNPT } from '@/lib/format'
import type { FloorsheetRow, FloorsheetAnalytics } from '@/types/market'

interface FloorsheetModalProps {
  symbol: string | null
  onClose: () => void
}

function fmtCrore(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1e7) return `Rs ${(n / 1e7).toFixed(2)}Cr`
  if (n >= 1e5) return `Rs ${(n / 1e5).toFixed(1)}L`
  return `Rs ${n.toLocaleString('en-NP', { maximumFractionDigits: 0 })}`
}

function AnalyticsBar({ analytics }: { analytics: FloorsheetAnalytics }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 bg-slate-800/50 border-b border-slate-700 text-xs">
      <span className="text-slate-400">
        VWAP <span className="text-slate-200 font-semibold tabular-nums">Rs {formatPrice(analytics.vwap)}</span>
      </span>
      <span className="text-slate-400">
        Trades <span className="text-slate-200 tabular-nums">{analytics.totalTrades.toLocaleString()}</span>
      </span>
      <span className="text-slate-400">
        Turnover <span className="text-slate-200 tabular-nums">{fmtCrore(analytics.totalTurnover)}</span>
      </span>
      <span className="text-slate-400">
        Median <span className="text-slate-200 tabular-nums">{analytics.medianTradeSize.toLocaleString('en-IN')} shr</span>
      </span>
    </div>
  )
}

export default function FloorsheetModal({ symbol, onClose }: FloorsheetModalProps) {
  const [trades, setTrades] = useState<FloorsheetRow[]>([])
  const [analytics, setAnalytics] = useState<FloorsheetAnalytics | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const backdropRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (sym: string) => {
    setLoading(true)
    setTrades([])
    setAnalytics(null)
    try {
      const data = await fetchFloorsheet(sym, 300)
      setTrades(data.trades)
      setAnalytics(data.analytics)
    } catch {
      // Leave the empty state showing rather than an unhandled rejection
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (symbol) load(symbol)
  }, [symbol, load])

  useEffect(() => {
    if (!symbol) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [symbol, onClose])

  // Keep the page behind from scrolling while the modal is open
  useEffect(() => {
    if (!symbol) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [symbol])

  if (!symbol) return null

  const modal = (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-[760px] max-w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">{symbol} — Floorsheet</h2>
            <span className="text-xs text-slate-500">{trades.length} trades</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { onClose(); router.push(`/stock/${encodeURIComponent(symbol)}`) }}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              Full Analysis →
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors text-xl leading-none px-2 -mr-2"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Analytics bar */}
        {analytics && !loading && <AnalyticsBar analytics={analytics} />}

        {/* Table */}
        <div className="overflow-y-auto overscroll-contain flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm animate-pulse">
              Loading trades…
            </div>
          ) : trades.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
              No floorsheet data available
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-800 text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Time (NPT)</th>
                  <th className="px-4 py-2 text-left font-medium">Buyer</th>
                  <th className="px-4 py-2 text-left font-medium">Seller</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Rate</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {trades.map((row) => {
                  const hasAnomaly = row.anomalies.length > 0
                  return (
                    <tr
                      key={row.contractNo}
                      className={`transition-colors ${hasAnomaly ? 'bg-amber-500/5 hover:bg-amber-500/10' : 'hover:bg-slate-800/50'}`}
                    >
                      <td className="px-4 py-1.5 text-slate-500">{formatNPT(row.time, false)}</td>
                      <td className="px-4 py-1.5 text-green-400 font-medium">{row.buyer}</td>
                      <td className="px-4 py-1.5 text-red-400 font-medium">{row.seller}</td>
                      <td className={`px-4 py-1.5 text-right tabular-nums ${hasAnomaly ? 'text-amber-400 font-semibold' : 'text-slate-300'}`}>
                        {row.quantity.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-1.5 text-right text-slate-300 tabular-nums">
                        {formatPrice(row.rate)}
                      </td>
                      <td className="px-4 py-1.5 text-right text-slate-400 tabular-nums">
                        {fmtCrore(row.amount)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {!loading && trades.length > 0 && (
          <div className="px-5 py-2.5 border-t border-slate-700 text-xs text-slate-500 shrink-0">
            {trades.length} trades shown
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
