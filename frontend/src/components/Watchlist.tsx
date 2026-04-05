'use client'

import { useEffect, useState } from 'react'

interface Stock {
  symbol: string
  ltp: number
  change: number
  changePercent: number
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

const DEFAULT_WATCHLIST: Stock[] = [
  { symbol: 'NABIL', ltp: 1234.50, change: 45.20, changePercent: 3.79 },
  { symbol: 'EIC', ltp: 2456.00, change: 67.80, changePercent: 2.84 },
  { symbol: 'ADBL', ltp: 456.20, change: 15.60, changePercent: 3.53 },
  { symbol: 'SBI', ltp: 567.30, change: 23.10, changePercent: 4.24 },
  { symbol: 'CCBL', ltp: 234.50, change: 8.90, changePercent: 3.94 },
  { symbol: 'KSBBL', ltp: 567.80, change: -23.10, changePercent: -3.91 },
]

export default function Watchlist() {
  const [watchlist, setWatchlist] = useState<Stock[]>(DEFAULT_WATCHLIST)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${API_URL}/api/stocks/latest`, {
          mode: 'cors',
        })

        if (response.ok) {
          const prices: Stock[] = await response.json()
          if (prices && prices.length > 0) {
            setWatchlist(prices.slice(0, 6))
          }
        }
      } catch (err) {
        // Silently fall back to defaults
      }
    }

    fetchData()
  }, [])

  return (
    <div>
      {/* Table Header */}
      <div className="grid grid-cols-4 gap-4 pb-3 mb-3 border-b border-slate-700 text-sm font-semibold text-slate-400">
        <div>Symbol</div>
        <div className="text-right">LTP</div>
        <div className="text-right">Change</div>
        <div className="text-right">%</div>
      </div>

      {/* Table Rows */}
      <div className="space-y-1">
        {watchlist.map((stock) => (
          <div
            key={stock.symbol}
            className="grid grid-cols-4 gap-4 py-2 px-3 hover:bg-slate-800 rounded transition-colors text-sm"
          >
            <div className="font-semibold text-white">{stock.symbol}</div>
            <div className="text-right text-slate-300">{stock.ltp.toFixed(2)}</div>
            <div className={`text-right font-medium ${stock.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}
            </div>
            <div className={`text-right font-medium ${stock.changePercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
