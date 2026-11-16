'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  fetchStockInsight, generateStockInsight, chatWithStock,
  fetchAIPredictions, fetchAIObservations,
} from '@/lib/api'
import type {
  StockInsight, StockChatMessage,
  StockInsightOptions, InsightHorizon, InsightSignal, InsightGoal,
  AIPrediction, AIObservation,
} from '@/types/market'

interface Props { symbol: string }

const DEFAULT_OPTIONS: StockInsightOptions = {
  horizon: 'medium_term',
  signals: ['trend', 'momentum', 'volume', 'volatility', 'relperf'],
  goal: 'neutral',
}

const HORIZONS: { value: InsightHorizon; label: string; desc: string }[] = [
  { value: 'short_term',  label: 'Short-term',  desc: '1–5 days · intraday momentum' },
  { value: 'medium_term', label: 'Swing',        desc: '1–4 weeks · trend + volume' },
  { value: 'long_term',   label: 'Long-term',    desc: '1–6 months · SMA50/200 + alpha' },
]

const SIGNALS: { value: InsightSignal; label: string }[] = [
  { value: 'trend',      label: 'Trend (SMA/EMA)' },
  { value: 'momentum',   label: 'Momentum (RSI/MACD)' },
  { value: 'volume',     label: 'Volume' },
  { value: 'volatility', label: 'Volatility (ATR/BB)' },
  { value: 'relperf',    label: 'vs NEPSE (Alpha)' },
]

const GOALS: { value: InsightGoal; label: string; color: string }[] = [
  { value: 'neutral', label: 'Balanced',     color: 'text-slate-300' },
  { value: 'entry',   label: 'Entry Points', color: 'text-green-400' },
  { value: 'exit',    label: 'Exit / TP',    color: 'text-yellow-400' },
  { value: 'risk',    label: 'Risk',         color: 'text-red-400' },
]

function formatNPT(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kathmandu',
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  })
}

function OptionsPanel({
  opts, onChange,
}: {
  opts: StockInsightOptions
  onChange: (o: StockInsightOptions) => void
}) {
  const toggleSignal = (s: InsightSignal) => {
    const next = opts.signals.includes(s)
      ? opts.signals.filter(x => x !== s)
      : [...opts.signals, s]
    onChange({ ...opts, signals: next.length ? next : opts.signals })
  }

  return (
    <div className="space-y-4 pt-1 pb-2">
      {/* Horizon */}
      <div>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Time Horizon</p>
        <div className="flex gap-2">
          {HORIZONS.map(h => (
            <button
              key={h.value}
              onClick={() => onChange({ ...opts, horizon: h.value })}
              title={h.desc}
              className={`flex-1 py-1.5 px-2 text-xs rounded-lg border transition-colors text-center ${
                opts.horizon === h.value
                  ? 'bg-blue-700 border-blue-600 text-white'
                  : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-200'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {/* Signal focus */}
      <div>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Signal Focus</p>
        <div className="flex flex-wrap gap-1.5">
          {SIGNALS.map(s => (
            <button
              key={s.value}
              onClick={() => toggleSignal(s.value)}
              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                opts.signals.includes(s.value)
                  ? 'bg-slate-600 border-slate-500 text-white'
                  : 'bg-slate-800/60 border-slate-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Goal */}
      <div>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Analysis Goal</p>
        <div className="flex gap-2">
          {GOALS.map(g => (
            <button
              key={g.value}
              onClick={() => onChange({ ...opts, goal: g.value })}
              className={`flex-1 py-1.5 px-2 text-xs rounded-lg border transition-colors text-center ${
                opts.goal === g.value
                  ? `bg-slate-700 border-slate-500 ${g.color} font-medium`
                  : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50',
  confirmed: 'bg-green-900/40 text-green-400 border-green-700/50',
  invalidated: 'bg-red-900/40 text-red-400 border-red-700/50',
  expired: 'bg-slate-800 text-slate-500 border-slate-700',
  partially_confirmed: 'bg-blue-900/40 text-blue-400 border-blue-700/50',
}

export default function StockAIPanel({ symbol }: Props) {
  const [insight, setInsight] = useState<StockInsight | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [options, setOptions] = useState<StockInsightOptions>(DEFAULT_OPTIONS)
  const [messages, setMessages] = useState<StockChatMessage[]>([])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Stock-specific memory
  const [predictions, setPredictions] = useState<AIPrediction[]>([])
  const [observations, setObservations] = useState<AIObservation[]>([])
  const [showMemory, setShowMemory] = useState(false)

  const loadMemory = useCallback(async () => {
    const [preds, obs] = await Promise.all([
      fetchAIPredictions({ symbol, limit: 5 }),
      fetchAIObservations({ symbol, limit: 5 }),
    ])
    setPredictions(preds)
    setObservations(obs)
  }, [symbol])

  useEffect(() => {
    fetchStockInsight(symbol).then(data => { if (data) setInsight(data) })
    loadMemory()
    setMessages([])
    setInput('')
    setError(null)
  }, [symbol, loadMemory])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatLoading])

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const data = await generateStockInsight(symbol, options)
      setInsight(data)
      setShowOptions(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate insight')
    } finally {
      setGenerating(false)
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || chatLoading) return
    const userMsg: StockChatMessage = { role: 'user', content: text }
    const next = [...messages, userMsg]
    setMessages(next)
    setInput('')
    setChatLoading(true)
    setError(null)
    try {
      const reply = await chatWithStock(symbol, next)
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chat request failed')
    } finally {
      setChatLoading(false)
    }
  }

  // Derive config badge from last insight's saved options
  const savedOpts = insight?.extra_data?.options as Partial<StockInsightOptions> | undefined
  const horizonLabel = HORIZONS.find(h => h.value === (savedOpts?.horizon ?? options.horizon))?.label
  const goalLabel    = GOALS.find(g => g.value === (savedOpts?.goal ?? options.goal))?.label

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-5 pb-4 border-b border-slate-700/60">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">AI Analysis</h3>
            <span className="text-xs px-2 py-0.5 bg-blue-900/50 text-blue-300 rounded">Claude</span>
            {insight && (
              <>
                <span className="text-xs px-2 py-0.5 bg-slate-700 text-slate-400 rounded">{horizonLabel}</span>
                {goalLabel && goalLabel !== 'Balanced' && (
                  <span className="text-xs px-2 py-0.5 bg-slate-700/60 text-slate-400 rounded">{goalLabel}</span>
                )}
                <span className="text-xs text-slate-600">{formatNPT(insight.generated_at)} NPT</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(predictions.length > 0 || observations.length > 0) && (
              <button
                onClick={() => setShowMemory(v => !v)}
                className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                  showMemory
                    ? 'bg-blue-700/80 border-blue-600 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                Memory {predictions.length > 0 ? `(${predictions.length})` : ''}
              </button>
            )}
            <button
              onClick={() => setShowOptions(v => !v)}
              className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                showOptions
                  ? 'bg-slate-700 border-slate-500 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              ⚙ Options
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
            >
              {generating ? (
                <>
                  <span className="inline-block w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                  Generating...
                </>
              ) : (
                <>↻ {insight ? 'Regenerate' : 'Generate'}</>
              )}
            </button>
          </div>
        </div>

        {/* Collapsible options */}
        {showOptions && (
          <div className="mt-1 border-t border-slate-700/60 pt-3">
            <OptionsPanel opts={options} onChange={setOptions} />
          </div>
        )}

        {/* Insight content */}
        {generating ? (
          <div className="space-y-2 animate-pulse mt-2">
            {[1, 5/6, 4/6, 1, 3/4].map((w, i) => (
              <div key={i} className="h-3.5 bg-slate-700 rounded" style={{ width: `${w * 100}%` }} />
            ))}
          </div>
        ) : insight ? (
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap mt-2">
            {insight.insight_text}
          </p>
        ) : (
          <p className="text-sm text-slate-500 mt-2">
            Configure options above then generate an AI analysis of {symbol}.
          </p>
        )}
      </div>

      {/* Stock memory section */}
      {showMemory && (predictions.length > 0 || observations.length > 0) && (
        <div className="px-5 py-3 border-b border-slate-700/60 space-y-3 max-h-60 overflow-y-auto bg-slate-800/30">
          {predictions.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Tracked Predictions
              </p>
              <div className="space-y-1.5">
                {predictions.map(p => (
                  <div key={p.id} className={`px-2.5 py-2 rounded border text-xs ${STATUS_COLORS[p.status] || STATUS_COLORS.pending}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-slate-200 leading-relaxed flex-1">{p.prediction_text}</p>
                      <span className="shrink-0 text-[10px] uppercase font-semibold tracking-wider opacity-70">
                        {p.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-1 text-[10px] text-slate-500">
                      <span>{p.prediction_date}</span>
                      {p.target_date && <span>Target: {p.target_date}</span>}
                    </div>
                    {p.resolution_text && (
                      <p className="mt-1 text-slate-400 italic">{p.resolution_text}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {observations.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                Recent Observations
              </p>
              <div className="space-y-1">
                {observations.map(o => (
                  <div key={o.id} className="px-2.5 py-1.5 rounded bg-slate-800/50 border border-slate-700/30">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] uppercase text-slate-600">{o.category}</span>
                      <span className="text-[10px] text-slate-600">{o.observation_date}</span>
                    </div>
                    <p className="text-xs text-slate-300">{o.observation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chat section */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-5 py-2.5 border-b border-slate-700/60 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Ask Claude about {symbol}
          </span>
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="ml-auto text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {messages.length > 0 && (
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 max-h-72">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed ${
                  msg.role === 'user' ? 'bg-blue-800/60 text-blue-100' : 'bg-slate-800 text-slate-200'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-800 px-3 py-2 rounded-lg">
                  <span className="flex gap-1 items-center">
                    {[0, 150, 300].map(d => (
                      <span key={d} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                        style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {error && (
          <div className="mx-5 my-2 px-3 py-2 bg-red-900/30 border border-red-700/40 rounded text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="p-4 flex gap-2 items-end border-t border-slate-700/60">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={`Ask about ${symbol} — entry points, technicals, comparisons...`}
            rows={2}
            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || chatLoading}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
