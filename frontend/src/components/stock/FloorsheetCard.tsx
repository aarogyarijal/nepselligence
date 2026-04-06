import { memo } from 'react'
import type { StockAnalysis } from '@/types/market'
import { TipLabel } from '@/components/Tooltip'

function fmt(n: number | null | undefined, decimals = 0) {
  if (n == null) return '—'
  return n.toLocaleString('en-NP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function BrokerTable({
  rows,
  label,
  tip,
  colorClass,
}: {
  rows: { broker: string; quantity: number; trades: number }[]
  label: string
  tip: string
  colorClass: string
}) {
  return (
    <div className="flex-1 min-w-0">
      <h3 className={`text-xs font-semibold mb-2 ${colorClass}`}>
        <TipLabel label={label} tip={tip} className={`${colorClass} border-current opacity-70`} />
      </h3>
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

function FloorsheetCard({ floorsheet }: { floorsheet: StockAnalysis['floorsheet'] }) {
  if (!floorsheet) return null

  const { topBuyers, topSellers, avgTradeSize, vwap, totalTrades } = floorsheet

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          <TipLabel
            label="Floorsheet"
            tip="Broker-level transaction data from today's NEPSE floorsheet. Each row on the floorsheet records one trade: buyer broker, seller broker, quantity, and price. This section aggregates those rows by broker to reveal which brokers are accumulating (buying) or distributing (selling)."
            className="text-slate-500 border-slate-600"
          />
        </h2>
        <TipLabel
          label={`${fmt(totalTrades)} trades`}
          tip="Total number of individual matched transactions recorded in today's floorsheet for this symbol."
          className="text-xs text-slate-500 border-slate-600"
        />
      </div>

      <div className="flex gap-6 mb-4">
        <BrokerTable
          rows={topBuyers}
          label="Top Buyers"
          tip="Brokers with the highest total buy quantity today, aggregated from the floorsheet. High buying from a single broker may indicate institutional accumulation. Broker codes correspond to NEPSE-registered member firms."
          colorClass="text-green-400"
        />
        <div className="w-px bg-slate-800" />
        <BrokerTable
          rows={topSellers}
          label="Top Sellers"
          tip="Brokers with the highest total sell quantity today. Concentrated selling by one broker may indicate a large holder exiting. Cross-referencing buyers and sellers can reveal block trades."
          colorClass="text-red-400"
        />
      </div>

      <div className="border-t border-slate-800 pt-3 flex gap-6 text-xs">
        <div>
          <TipLabel
            label="VWAP"
            tip={
              <span>
                <b>Volume Weighted Average Price</b> — the average price at which today&apos;s shares traded, weighted by volume.<br /><br />
                Formula: Σ(price × quantity) / Σ(quantity) across all floorsheet rows today.<br /><br />
                Price above VWAP = stock trading above today&apos;s average cost. Institutional traders often use VWAP as a benchmark — buying below it is considered favorable execution.
              </span>
            }
            className="text-slate-500 border-slate-600"
          />
          <span className="ml-2 text-slate-200 tabular-nums">Rs {fmt(vwap, 2)}</span>
        </div>
        <div>
          <TipLabel
            label="Avg Trade"
            tip="Average number of shares per matched transaction today. Larger average trade sizes suggest institutional or informed trading. Small sizes suggest retail participation."
            className="text-slate-500 border-slate-600"
          />
          <span className="ml-2 text-slate-200 tabular-nums">{fmt(avgTradeSize)} shares</span>
        </div>
      </div>
    </div>
  )
}

export default memo(FloorsheetCard)
