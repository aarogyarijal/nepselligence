'use client'

import { useEffect, useState } from 'react'
import { fetchMarketOverview, fetchCompanies } from '@/lib/api'
import { formatPrice, formatChange, formatChangePct, changeClass, changeArrow } from '@/lib/format'
import { usePolling } from '@/hooks/usePolling'
import type { MarketOverview, Company } from '@/types/market'

interface MarketStatusBarProps {
  onSymbolSearch: (symbol: string) => void
  isOpen: boolean
}

export default function MarketStatusBar({ onSymbolSearch, isOpen }: MarketStatusBarProps) {
  const [overview, setOverview] = useState<MarketOverview | null>(null)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Company[]>([])
  const [allCompanies, setAllCompanies] = useState<Company[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  const load = async () => {
    try {
      const envelope = await fetchMarketOverview()
      if (envelope.data) setOverview(envelope.data)
    } catch {}
  }

  useEffect(() => { load() }, [])
  usePolling(load, 60_000, isOpen)

  // Load companies for autocomplete
  useEffect(() => {
    fetchCompanies()
      .then(envelope => setAllCompanies(envelope.data || []))
      .catch(() => {})
  }, [])

  const handleQuery = (value: string) => {
    setQuery(value)
    if (value.length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    const upper = value.toUpperCase()
    const matches = allCompanies
      .filter(c => c.symbol.includes(upper) || c.name.toUpperCase().includes(upper))
      .slice(0, 10)
    setSuggestions(matches)
    setShowSuggestions(matches.length > 0)
  }

  const selectSymbol = (symbol: string) => {
    setQuery(symbol)
    setShowSuggestions(false)
    onSymbolSearch(symbol)
  }

  const nepse = overview?.indices.find(i => i.name.includes('NEPSE') || i.name === 'NEPSE Index')
  const sensitive = overview?.indices.find(i => i.name.toLowerCase().includes('sensitive'))
  const float = overview?.indices.find(i => i.name.toLowerCase().includes('float') && !i.name.toLowerCase().includes('sensitive'))
  const sensFloat = overview?.indices.find(i => i.name.toLowerCase().includes('sensit') && i.name.toLowerCase().includes('float'))

  return (
    <div className="bg-slate-900 border-b border-slate-700 px-6 py-2 flex items-center gap-6 text-sm flex-wrap">
      {/* Market status indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={`w-2 h-2 rounded-full ${isOpen ? 'bg-green-500' : 'bg-slate-500'}`} />
        <span className={`font-semibold ${isOpen ? 'text-green-400' : 'text-slate-400'}`}>
          {isOpen ? 'OPEN' : 'CLOSED'}
        </span>
      </div>

      {/* Index pills */}
      <div className="flex items-center gap-4 flex-wrap">
        {[
          { label: 'NEPSE', data: nepse },
          { label: 'Sensitive', data: sensitive },
          { label: 'Float', data: float },
          { label: 'SensFloat', data: sensFloat },
        ].map(({ label, data }) => (
          data ? (
            <div key={label} className="flex items-center gap-1.5">
              <span className="text-slate-400">{label}</span>
              <span className="text-white font-medium">{formatPrice(data.value)}</span>
              <span className={`${changeClass(data.change)} text-xs`}>
                {changeArrow(data.change)} {formatChange(data.change)} ({formatChangePct(data.changePct)})
              </span>
            </div>
          ) : null
        ))}
      </div>

      {/* Market summary */}
      {overview?.summary && (
        <div className="flex items-center gap-4 text-xs text-slate-400 border-l border-slate-700 pl-4 flex-wrap">
          <span>Turnover: Rs {((overview.summary.totalTurnover || 0) / 1_00_00_000).toFixed(2)} Cr</span>
          <span>Trades: {(overview.summary.totalTransactions || 0).toLocaleString()}</span>
          <span>Shares: {((overview.summary.totalShares || 0) / 1_000_000).toFixed(1)}M</span>
        </div>
      )}

      {/* Spacer + Search */}
      <div className="ml-auto relative">
        <input
          type="text"
          value={query}
          onChange={e => handleQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && query.length >= 2) {
              selectSymbol(query.toUpperCase())
            }
            if (e.key === 'Escape') setShowSuggestions(false)
          }}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="Search symbol..."
          className="bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-3 py-1.5 w-48 focus:outline-none focus:border-slate-400"
          aria-label="Search stock symbol"
          aria-autocomplete="list"
        />
        {showSuggestions && (
          <div className="absolute right-0 top-full mt-1 w-64 bg-slate-800 border border-slate-600 rounded shadow-xl z-50 max-h-64 overflow-y-auto">
            {suggestions.map(c => (
              <button
                key={c.symbol}
                onMouseDown={() => selectSymbol(c.symbol)}
                className="w-full text-left px-3 py-2 hover:bg-slate-700 text-xs"
              >
                <span className="font-semibold text-white">{c.symbol}</span>
                <span className="text-slate-400 ml-2 truncate">{c.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
