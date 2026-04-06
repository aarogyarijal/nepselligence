import type { StockAnalysis } from '@/types/market'
import { TipLabel } from '@/components/Tooltip'
import { formatPrice } from '@/lib/format'

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
            <TipLabel
              label="RSI (14)"
              tip={
                <span>
                  <b>Relative Strength Index</b> — a momentum oscillator that measures the speed and magnitude of recent price changes on a 0–100 scale.<br /><br />
                  Calculated using Wilder&apos;s smoothing over 14 trading sessions.<br /><br />
                  Vertical markers: <b className="text-green-400">30</b> (oversold) · <b className="text-red-400">70</b> (overbought)
                </span>
              }
              className="text-xs text-slate-500 border-slate-600"
            />
            {rsi14 != null && (
              <span className="text-xs text-slate-400">
                {rsi14 > 70 ? 'Overbought' : rsi14 < 30 ? 'Oversold' : 'Neutral'}
              </span>
            )}
          </div>
          {rsi14 != null ? (
            <RSIBar value={rsi14} />
          ) : <span className="text-xs text-slate-500">—</span>}
        </div>

        <Divider />

        {/* MACD */}
        <Row
          label={
            <TipLabel
              label="MACD"
              tip={
                <span>
                  <b>Moving Average Convergence Divergence</b> (12-26-9)<br /><br />
                  <b>MACD line</b>: EMA12 − EMA26<br />
                  <b>Signal line</b>: 9-period EMA of the MACD line<br />
                  <b>Histogram</b>: MACD − Signal. Positive = bullish momentum, negative = bearish.<br /><br />
                  Displayed as: <i>MACD / Signal · H: Histogram</i>
                </span>
              }
              className="text-xs text-slate-500 border-slate-600"
            />
          }
        >
          {macd ? (
            <span className="text-xs tabular-nums">
              <span className={macd.macd >= 0 ? 'text-green-400' : 'text-red-400'}>{formatPrice(macd.macd)}</span>
              <span className="text-slate-500"> / </span>
              <span className="text-slate-300">{formatPrice(macd.signal)}</span>
              <span className="text-slate-500"> H: </span>
              <span className={macd.histogram >= 0 ? 'text-green-400' : 'text-red-400'}>{formatPrice(macd.histogram)}</span>
            </span>
          ) : '—'}
        </Row>

        <Row
          label={
            <TipLabel
              label="ATR (14)"
              tip={
                <span>
                  <b>Average True Range</b> — measures market volatility by averaging the True Range over 14 sessions.<br /><br />
                  True Range = max(High−Low, |High−PrevClose|, |Low−PrevClose|)<br /><br />
                  A higher ATR means larger average daily price swings. Useful for setting stop-losses.
                </span>
              }
              className="text-xs text-slate-500 border-slate-600"
            />
          }
        >
          Rs {formatPrice(atr14)}
        </Row>

        <Divider />

        {/* Bollinger */}
        <Row
          label={
            <TipLabel
              label="Bollinger"
              tip={
                <span>
                  <b>Bollinger Bands</b> (20-period, 2 std deviations)<br /><br />
                  <b>Middle</b>: 20-day SMA<br />
                  <b>Upper/Lower</b>: Middle ± 2× standard deviation of closes<br /><br />
                  Displayed as: <i>Lower | Middle | Upper</i><br /><br />
                  Price near upper band = stretched to upside. Near lower band = stretched to downside.
                </span>
              }
              className="text-xs text-slate-500 border-slate-600"
            />
          }
        >
          {bollingerBands ? (
            <span className="text-xs tabular-nums text-slate-300">
              {formatPrice(bollingerBands.lower)} | {formatPrice(bollingerBands.middle)} | {formatPrice(bollingerBands.upper)}
            </span>
          ) : '—'}
        </Row>

        <Divider />

        <Row
          label={
            <TipLabel
              label="SMA 20"
              tip="Simple Moving Average of the last 20 closing prices. Short-term trend indicator. Price above SMA20 = near-term uptrend."
              className="text-xs text-slate-500 border-slate-600"
            />
          }
        >
          <span className="text-yellow-400">Rs {formatPrice(sma20)}</span>
        </Row>

        <Row
          label={
            <TipLabel
              label="SMA 50"
              tip="Simple Moving Average of the last 50 closing prices. Medium-term trend indicator. SMA50 crossing above SMA200 is a 'golden cross' (bullish signal)."
              className="text-xs text-slate-500 border-slate-600"
            />
          }
        >
          <span className="text-orange-400">Rs {formatPrice(sma50)}</span>
        </Row>

        <Row
          label={
            <TipLabel
              label="SMA 200"
              tip="Simple Moving Average of the last 200 closing prices. Long-term trend baseline. Price above SMA200 = long-term bull market; below = bear market."
              className="text-xs text-slate-500 border-slate-600"
            />
          }
        >
          <span className="text-purple-400">Rs {formatPrice(sma200)}</span>
        </Row>

        <Row
          label={
            <TipLabel
              label="EMA 12"
              tip="Exponential Moving Average of the last 12 sessions. Weights recent prices more heavily than older ones. Used as the fast line in MACD."
              className="text-xs text-slate-500 border-slate-600"
            />
          }
        >
          {formatPrice(ema12) !== '—' ? `Rs ${formatPrice(ema12)}` : '—'}
        </Row>

        <Row
          label={
            <TipLabel
              label="EMA 26"
              tip="Exponential Moving Average of the last 26 sessions. Slower EMA used as the baseline in MACD. When EMA12 crosses above EMA26, it generates a bullish MACD crossover."
              className="text-xs text-slate-500 border-slate-600"
            />
          }
        >
          {formatPrice(ema26) !== '—' ? `Rs ${formatPrice(ema26)}` : '—'}
        </Row>

      </div>
    </div>
  )
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
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
