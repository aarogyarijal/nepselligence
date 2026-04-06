import type { StockAnalysis } from '@/types/market'

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—'
  return n.toLocaleString('en-NP', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function RSIBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value))
  const color = value > 70 ? '#f87171' : value < 30 ? '#4ade80' : '#facc15'
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full relative">
        <div
          className="absolute left-0 top-0 h-1.5 rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
        {/* overbought/oversold markers */}
        <div className="absolute top-0 h-1.5 w-px bg-slate-500" style={{ left: '30%' }} />
        <div className="absolute top-0 h-1.5 w-px bg-slate-500" style={{ left: '70%' }} />
      </div>
      <span className="text-xs tabular-nums" style={{ color }}>{value.toFixed(1)}</span>
    </div>
  )
}

export default function TechnicalsCard({ technicals }: { technicals: StockAnalysis['technicals'] }) {
  const { sma20, sma50, sma200, ema12, ema26, rsi14, macd, bollingerBands, atr14 } = technicals

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">Technicals</h2>
      <div className="space-y-3">
        {/* RSI */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500">RSI (14)</span>
            {rsi14 != null && <span className="text-xs text-slate-400">
              {rsi14 > 70 ? 'Overbought' : rsi14 < 30 ? 'Oversold' : 'Neutral'}
            </span>}
          </div>
          {rsi14 != null ? (
            <RSIBar value={rsi14} />
          ) : <span className="text-xs text-slate-500">—</span>}
        </div>

        <Divider />

        {/* MACD */}
        <Row label="MACD">
          {macd ? (
            <span className="text-xs tabular-nums">
              <span className={macd.macd >= 0 ? 'text-green-400' : 'text-red-400'}>{fmt(macd.macd)}</span>
              <span className="text-slate-500"> / </span>
              <span className="text-slate-300">{fmt(macd.signal)}</span>
              <span className="text-slate-500"> H: </span>
              <span className={macd.histogram >= 0 ? 'text-green-400' : 'text-red-400'}>{fmt(macd.histogram)}</span>
            </span>
          ) : '—'}
        </Row>

        <Row label="ATR (14)">Rs {fmt(atr14)}</Row>

        <Divider />

        {/* Bollinger */}
        <Row label="Bollinger">
          {bollingerBands ? (
            <span className="text-xs tabular-nums text-slate-300">
              {fmt(bollingerBands.lower)} | {fmt(bollingerBands.middle)} | {fmt(bollingerBands.upper)}
            </span>
          ) : '—'}
        </Row>

        <Divider />

        {/* SMAs */}
        <Row label="SMA 20"><span className="text-yellow-400">Rs {fmt(sma20)}</span></Row>
        <Row label="SMA 50"><span className="text-orange-400">Rs {fmt(sma50)}</span></Row>
        <Row label="SMA 200"><span className="text-purple-400">Rs {fmt(sma200)}</span></Row>
        <Row label="EMA 12">{fmt(ema12) !== '—' ? `Rs ${fmt(ema12)}` : '—'}</Row>
        <Row label="EMA 26">{fmt(ema26) !== '—' ? `Rs ${fmt(ema26)}` : '—'}</Row>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-300">{children}</span>
    </div>
  )
}

function Divider() {
  return <div className="border-t border-slate-800" />
}
