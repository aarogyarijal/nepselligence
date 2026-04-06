import type { StockAnalysis } from '@/types/market'

function fmt(n: number | null | undefined, decimals = 0) {
  if (n == null) return '—'
  return n.toLocaleString('en-NP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function BrokerTable({
  rows,
  label,
  colorClass,
}: {
  rows: { broker: string; quantity: number; trades: number }[]
  label: string
  colorClass: string
}) {
  return (
    <div className="flex-1 min-w-0">
      <h3 className={`text-xs font-semibold mb-2 ${colorClass}`}>{label}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">No data</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left pb-1 font-normal">Broker</th>
              <th className="text-right pb-1 font-normal">Qty</th>
              <th className="text-right pb-1 font-normal">Trades</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-800">
                <td className="py-1 text-slate-300">{r.broker}</td>
                <td className="py-1 text-right text-slate-300 tabular-nums">{fmt(r.quantity)}</td>
                <td className="py-1 text-right text-slate-400 tabular-nums">{r.trades}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function FloorsheetCard({ floorsheet }: { floorsheet: StockAnalysis['floorsheet'] }) {
  if (!floorsheet) return null

  const { topBuyers, topSellers, avgTradeSize, vwap, totalTrades } = floorsheet

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Floorsheet</h2>
        <span className="text-xs text-slate-500">{fmt(totalTrades)} trades</span>
      </div>

      <div className="flex gap-6 mb-4">
        <BrokerTable rows={topBuyers} label="Top Buyers" colorClass="text-green-400" />
        <div className="w-px bg-slate-800" />
        <BrokerTable rows={topSellers} label="Top Sellers" colorClass="text-red-400" />
      </div>

      <div className="border-t border-slate-800 pt-3 flex gap-6 text-xs">
        <div>
          <span className="text-slate-500">VWAP</span>
          <span className="ml-2 text-slate-200 tabular-nums">Rs {fmt(vwap, 2)}</span>
        </div>
        <div>
          <span className="text-slate-500">Avg Trade</span>
          <span className="ml-2 text-slate-200 tabular-nums">{fmt(avgTradeSize)} shares</span>
        </div>
      </div>
    </div>
  )
}
