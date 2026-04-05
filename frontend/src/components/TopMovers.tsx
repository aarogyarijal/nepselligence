'use client'

import { useState } from 'react'

interface Stock {
  symbol: string
  ltp: number
  change: number
  changePercent: number
}

export default function TopMovers() {
  const [activeTab, setActiveTab] = useState<'gainers' | 'losers'>('gainers')

  // Mock data
  const gainers: Stock[] = [
    { symbol: 'NABIL', ltp: 1234.50, change: 45.20, changePercent: 3.79 },
    { symbol: 'EIC', ltp: 2456.00, change: 67.80, changePercent: 2.84 },
    { symbol: 'SBI', ltp: 567.30, change: 23.10, changePercent: 4.24 },
    { symbol: 'ADBL', ltp: 456.20, change: 15.60, changePercent: 3.53 },
    { symbol: 'CCBL', ltp: 234.50, change: 8.90, changePercent: 3.94 },
  ]

  const losers: Stock[] = [
    { symbol: 'BBBL', ltp: 123.40, change: -15.20, changePercent: -10.98 },
    { symbol: 'KSBBL', ltp: 567.80, change: -23.10, changePercent: -3.91 },
    { symbol: 'SLBBL', ltp: 234.50, change: -8.90, changePercent: -3.65 },
    { symbol: 'BNHC', ltp: 456.20, change: -12.60, changePercent: -2.68 },
    { symbol: 'GBBL', ltp: 789.30, change: -19.80, changePercent: -2.45 },
  ]

  const data = activeTab === 'gainers' ? gainers : losers

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-4 mb-4 border-b border-slate-700">
        <button
          onClick={() => setActiveTab('gainers')}
          className={`pb-2 font-medium transition-colors ${
            activeTab === 'gainers'
              ? 'text-green-500 border-b-2 border-green-500'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Gainers
        </button>
        <button
          onClick={() => setActiveTab('losers')}
          className={`pb-2 font-medium transition-colors ${
            activeTab === 'losers'
              ? 'text-red-500 border-b-2 border-red-500'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Losers
        </button>
      </div>

      {/* Table */}
      <div className="space-y-2">
        {data.map((stock) => (
          <div
            key={stock.symbol}
            className="flex justify-between items-center py-2 px-3 hover:bg-slate-800 rounded transition-colors"
          >
            <div>
              <div className="font-semibold text-white">{stock.symbol}</div>
              <div className="text-sm text-slate-400">Rs {stock.ltp.toFixed(2)}</div>
            </div>
            <div className={`text-right ${stock.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              <div className="font-semibold">
                {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}
              </div>
              <div className="text-sm">
                {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent.toFixed(2)}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
