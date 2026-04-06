'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { fetchFloorsheet } from '@/lib/api'
import { formatPrice, formatVolume, formatNPT } from '@/lib/format'
import type { FloorsheetRow } from '@/types/market'

interface FloorsheetModalProps {
  symbol: string | null
  onClose: () => void
}

export default function FloorsheetModal({ symbol, onClose }: FloorsheetModalProps) {
  const [rows, setRows] = useState<FloorsheetRow[]>([])
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const backdropRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (sym: string) => {
    setLoading(true)
    setRows([])
    try {
      const data = await fetchFloorsheet(sym)
      setRows(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (symbol) load(symbol)
  }, [symbol, load])

  // Close on Escape
  useEffect(() => {
    if (!symbol) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [symbol, onClose])

  if (!symbol) return null

  const modal = (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-[760px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">{symbol} — Floorsheet</h2>
            <span className="text-xs text-slate-500">Recent trades</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { onClose(); router.push(`/stock/${encodeURIComponent(symbol)}`) }}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              View Full Analysis →
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm animate-pulse">
              Loading trades…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-slate-500 text-sm">
              No floorsheet data available
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-800 text-slate-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Time</th>
                  <th className="px-4 py-2 text-left font-medium">Buyer</th>
                  <th className="px-4 py-2 text-left font-medium">Seller</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Rate</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-1.5 text-slate-500">{formatNPT(row.time)}</td>
                    <td className="px-4 py-1.5 text-green-400 font-medium">{row.buyer}</td>
                    <td className="px-4 py-1.5 text-red-400 font-medium">{row.seller}</td>
                    <td className="px-4 py-1.5 text-right text-slate-300">{row.quantity.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-1.5 text-right text-slate-300">{formatPrice(row.rate)}</td>
                    <td className="px-4 py-1.5 text-right text-slate-400">
                      {formatVolume(row.quantity * row.rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {!loading && rows.length > 0 && (
          <div className="px-5 py-3 border-t border-slate-700 text-xs text-slate-500 shrink-0">
            {rows.length} trades shown · Buyer = green, Seller = red
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
