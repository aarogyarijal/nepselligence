'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  fetchLatestInsight,
  fetchInsightHistory,
  generateMarketInsight,
  fetchAIPredictions,
  fetchAIScorecard,
  fetchAIRegimeHistory,
  fetchAIPatterns,
  fetchAIObservations,
} from '@/lib/api'
import { useFreshness } from '@/hooks/useFreshness'
import { usePolling } from '@/hooks/usePolling'
import { formatNPT } from '@/lib/format'
import { TipLabel } from '@/components/Tooltip'
import type {
  AIInsight,
  InsightType,
  MarketInsightOptions,
  MarketFocus,
  InsightDepth,
  AIPrediction,
  AIPredictionScorecard,
  AIMarketRegime,
  AIPattern,
  AIObservation,
} from '@/types/market'

// ---------------------------------------------------------------------------
// Top-level navigation: Insights vs Memory tabs
// ---------------------------------------------------------------------------
type MainView = 'insights' | 'predictions' | 'observations' | 'patterns'

// Insight sub-tabs
type InsightTab = 'Summary' | 'Signals' | 'Anomalies'
const INSIGHT_TABS: InsightTab[] = ['Summary', 'Signals', 'Anomalies']

const INSIGHT_TYPE_LABELS: Record<InsightType, string> = {
  market_open: 'Market Open',
  hourly: 'Hourly',
  daily_close: 'Close',
  weekly_wrap: 'Weekly',
}

interface ParsedInsight {
  summary: string
  signals: string
  anomalies: string
  raw: string
}

function parseInsight(text: string): ParsedInsight {
  const extract = (label: string, nextLabel?: string): string => {
    const re = new RegExp(`${label}:?\\s*`, 'i')
    const start = text.search(re)
    if (start === -1) return ''
    const afterLabel = text.slice(start).replace(re, '')
    const endRe = nextLabel ? new RegExp(`${nextLabel}:?\\s*`, 'i') : null
    const endIdx = endRe ? afterLabel.search(endRe) : -1
    return (endIdx === -1 ? afterLabel : afterLabel.slice(0, endIdx)).trim()
  }
  return {
    summary: extract('SUMMARY', 'SIGNALS'),
    signals: extract('SIGNALS', 'ANOMALIES'),
    anomalies: extract('ANOMALIES'),
    raw: text,
  }
}

function freshnessLabel(state: string, lastUpdated: string | null): string {
  if (state === 'fresh') return ''
  if (!lastUpdated) return ''
  if (state === 'aging') {
    const mins = Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 60_000)
    return `Updated ${mins}m ago`
  }
  return `As of ${formatNPT(lastUpdated)}`
}

const FOCUS_OPTIONS: { value: MarketFocus; label: string }[] = [
  { value: 'index',   label: 'Index' },
  { value: 'sectors', label: 'Sectors' },
  { value: 'breadth', label: 'Breadth' },
  { value: 'movers',  label: 'Top Movers' },
]

const INSIGHT_TYPES: { value: InsightType; label: string }[] = [
  { value: 'market_open', label: 'Open' },
  { value: 'hourly',      label: 'Hourly' },
  { value: 'daily_close', label: 'Close' },
  { value: 'weekly_wrap', label: 'Weekly' },
]

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50',
  confirmed: 'bg-green-900/40 text-green-400 border-green-700/50',
  invalidated: 'bg-red-900/40 text-red-400 border-red-700/50',
  expired: 'bg-slate-800 text-slate-500 border-slate-700',
  partially_confirmed: 'bg-blue-900/40 text-blue-400 border-blue-700/50',
}

const TREND_COLORS: Record<string, string> = {
  bullish: 'text-green-400',
  bearish: 'text-red-400',
  sideways: 'text-yellow-400',
  transitioning: 'text-blue-400',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AIPanelProps {
  isOpen: boolean
}

export default function AIPanel({ isOpen }: AIPanelProps) {
  // Main view state
  const [mainView, setMainView] = useState<MainView>('insights')

  // Insights state
  const [insight, setInsight] = useState<AIInsight | null>(null)
  const [history, setHistory] = useState<AIInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [activeTab, setActiveTab] = useState<InsightTab>('Summary')
  const [showHistory, setShowHistory] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genType, setGenType] = useState<InsightType>('daily_close')
  const [genOptions, setGenOptions] = useState<MarketInsightOptions>({
    depth: 'detailed',
    focus: ['index', 'sectors', 'breadth', 'movers'],
  })

  // Memory state
  const [predictions, setPredictions] = useState<AIPrediction[]>([])
  const [scorecard, setScorecard] = useState<AIPredictionScorecard | null>(null)
  const [regime, setRegime] = useState<AIMarketRegime | null>(null)
  const [patterns, setPatterns] = useState<AIPattern[]>([])
  const [observations, setObservations] = useState<AIObservation[]>([])
  const [predFilter, setPredFilter] = useState<string>('pending')
  const [memoryLoading, setMemoryLoading] = useState(false)

  // --- Load insights ---
  const loadInsights = useCallback(async () => {
    try {
      const [latest, hist] = await Promise.all([
        fetchLatestInsight(),
        fetchInsightHistory(8),
      ])
      setInsight(latest)
      setHistory(hist)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // --- Load memory data ---
  const loadMemory = useCallback(async () => {
    setMemoryLoading(true)
    try {
      const [preds, sc, regimes, pats, obs] = await Promise.all([
        fetchAIPredictions({ status: predFilter, limit: 15 }),
        fetchAIScorecard(30),
        fetchAIRegimeHistory(7),
        fetchAIPatterns(),
        fetchAIObservations({ days: 7, limit: 20 }),
      ])
      setPredictions(preds)
      setScorecard(sc)
      if (regimes.length > 0) setRegime(regimes[0])
      setPatterns(pats)
      setObservations(obs)
    } catch {
      // Memory data is supplementary — don't block on errors
    } finally {
      setMemoryLoading(false)
    }
  }, [predFilter])

  useEffect(() => { loadInsights() }, [loadInsights])
  useEffect(() => { loadMemory() }, [loadMemory])
  usePolling(loadInsights, isOpen ? 60_000 : 300_000, true)
  usePolling(loadMemory, 300_000, true)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      await generateMarketInsight(genType, genOptions)
      await loadInsights()
      setShowGenerate(false)
    } catch {
      setError(true)
    } finally {
      setGenerating(false)
    }
  }

  const toggleFocus = (f: MarketFocus) => {
    const next = genOptions.focus.includes(f)
      ? genOptions.focus.filter(x => x !== f)
      : [...genOptions.focus, f]
    setGenOptions(o => ({ ...o, focus: next.length ? next : o.focus }))
  }

  const freshness = useFreshness(insight?.generated_at, isOpen)
  const parsed = insight ? parseInsight(insight.insight_text) : null
  const hasSections = parsed && (parsed.summary || parsed.signals || parsed.anomalies)

  const getTabContent = (): string => {
    if (!parsed) return ''
    if (!hasSections) return parsed.raw
    if (activeTab === 'Summary') return parsed.summary
    if (activeTab === 'Signals') return parsed.signals
    return parsed.anomalies
  }

  const otherInsights = history.filter(h => h.generated_at !== insight?.generated_at)

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-700 p-5 h-full flex flex-col">
      {/* Regime bar (always visible when available) */}
      {regime && (
        <div className="flex items-center gap-3 mb-3 px-2 py-1.5 bg-slate-800/60 rounded border border-slate-700/50 shrink-0">
          <span className={`text-xs font-semibold ${TREND_COLORS[regime.trend] || 'text-slate-400'}`}>
            {regime.trend.toUpperCase()}
          </span>
          <span className="text-xs text-slate-500">Day {regime.regime_duration_days}</span>
          {regime.volatility_regime && (
            <span className="text-xs text-slate-500">Vol: {regime.volatility_regime}</span>
          )}
          {regime.breadth_health && (
            <span className="text-xs text-slate-500">Breadth: {regime.breadth_health}</span>
          )}
          {scorecard && scorecard.total > 0 && (
            <span className="ml-auto text-xs text-slate-500">
              Pred: {scorecard.hit_rate_pct.toFixed(0)}% hit ({scorecard.confirmed}/{scorecard.total})
              {scorecard.edge_pct != null && (
                <>
                  {' '}
                  <TipLabel
                    label={`${scorecard.edge_pct > 0 ? '+' : ''}${scorecard.edge_pct.toFixed(0)} vs baseline`}
                    tip={`A forecaster assuming nothing changes scored ${scorecard.baseline_hit_rate_pct?.toFixed(0)}% on the same predictions`}
                    className={scorecard.edge_pct > 0 ? 'text-green-400' : 'text-slate-500'}
                  />
                </>
              )}
            </span>
          )}
        </div>
      )}

      {/* Main navigation */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-1">
          {(['insights', 'predictions', 'observations', 'patterns'] as MainView[]).map(view => (
            <button
              key={view}
              onClick={() => setMainView(view)}
              className={`px-2.5 py-1 text-xs rounded transition-colors capitalize ${
                mainView === view
                  ? 'bg-blue-700/80 text-white'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
              }`}
            >
              {view}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {mainView === 'insights' && (
            <>
              {freshness !== 'fresh' && insight && (
                <span className={`text-xs ${freshness === 'aging' ? 'text-yellow-400' : 'text-slate-500'}`}>
                  {freshnessLabel(freshness, insight.generated_at)}
                </span>
              )}
              {otherInsights.length > 0 && (
                <button
                  onClick={() => setShowHistory(v => !v)}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showHistory ? 'Hide' : `+${otherInsights.length}`}
                </button>
              )}
              <button
                onClick={() => setShowGenerate(v => !v)}
                className={`px-2 py-1 text-xs rounded-lg border transition-colors ${
                  showGenerate
                    ? 'bg-slate-700 border-slate-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                ⚙
              </button>
            </>
          )}
        </div>
      </div>

      {/* ----------- INSIGHTS VIEW ----------- */}
      {mainView === 'insights' && (
        <>
          {/* Generate options panel */}
          {showGenerate && (
            <div className="mb-3 p-3 border border-slate-700 rounded-lg bg-slate-800/60 space-y-3 shrink-0">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Type</p>
                <div className="flex gap-1.5">
                  {INSIGHT_TYPES.map(t => (
                    <button key={t.value} onClick={() => setGenType(t.value)}
                      className={`flex-1 py-1 text-xs rounded border transition-colors ${
                        genType === t.value
                          ? 'bg-blue-700 border-blue-600 text-white'
                          : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'
                      }`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Depth</p>
                <div className="flex gap-1.5">
                  {(['brief', 'detailed'] as InsightDepth[]).map(d => (
                    <button key={d} onClick={() => setGenOptions(o => ({ ...o, depth: d }))}
                      className={`flex-1 py-1 text-xs rounded border transition-colors capitalize ${
                        genOptions.depth === d
                          ? 'bg-slate-600 border-slate-500 text-white'
                          : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'
                      }`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Focus</p>
                <div className="flex flex-wrap gap-1.5">
                  {FOCUS_OPTIONS.map(f => (
                    <button key={f.value} onClick={() => toggleFocus(f.value)}
                      className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                        genOptions.focus.includes(f.value)
                          ? 'bg-slate-600 border-slate-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
                      }`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {generating ? 'Generating…' : '↻ Generate Now'}
              </button>
            </div>
          )}

          {/* History dropdown */}
          {showHistory && otherInsights.length > 0 && (
            <div className="mb-3 shrink-0 border border-slate-700 rounded bg-slate-800/60 divide-y divide-slate-700/60 max-h-40 overflow-y-auto">
              {otherInsights.map(h => (
                <button
                  key={h.generated_at}
                  onClick={() => { setInsight(h); setShowHistory(false) }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-700/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded">
                      {INSIGHT_TYPE_LABELS[h.insight_type] ?? h.insight_type}
                    </span>
                    <span className="text-xs text-slate-500">{formatNPT(h.generated_at)}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-1">{h.insight_text.slice(0, 120)}</p>
                </button>
              ))}
            </div>
          )}

          {/* Insight sub-tabs */}
          {!loading && !error && hasSections && (
            <div className="flex gap-4 border-b border-slate-700 mb-3 shrink-0" role="tablist" aria-label="AI insight sections">
              {INSIGHT_TABS.map(tab => (
                <button
                  key={tab} role="tab" aria-selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={e => {
                    const idx = INSIGHT_TABS.indexOf(tab)
                    if (e.key === 'ArrowRight') setActiveTab(INSIGHT_TABS[(idx + 1) % INSIGHT_TABS.length])
                    if (e.key === 'ArrowLeft') setActiveTab(INSIGHT_TABS[(idx - 1 + INSIGHT_TABS.length) % INSIGHT_TABS.length])
                  }}
                  className={`pb-2 text-sm font-medium transition-colors ${
                    activeTab === tab ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400 hover:text-slate-300'
                  }`}
                >{tab}</button>
              ))}
            </div>
          )}

          {/* Insight content */}
          <div className="flex-1 overflow-y-auto">
            {loading || generating ? (
              <div className="space-y-2 animate-pulse">
                {generating && <p className="text-xs text-blue-400 mb-3">Generating insight with Claude…</p>}
                <div className="h-4 bg-slate-700 rounded w-full" />
                <div className="h-4 bg-slate-700 rounded w-5/6" />
                <div className="h-4 bg-slate-700 rounded w-4/6" />
                <div className="h-4 bg-slate-700 rounded w-3/4" />
              </div>
            ) : error ? (
              <p className="text-slate-400 text-sm">Analysis unavailable — check pipeline status.</p>
            ) : !insight ? (
              <p className="text-slate-500 text-sm">No insights yet. Generate one from the ⚙ menu.</p>
            ) : (
              <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                {getTabContent() || insight.insight_text}
              </p>
            )}
          </div>

          {insight && (
            <div className="mt-3 pt-2 border-t border-slate-700 text-xs text-slate-600 shrink-0">
              {formatNPT(insight.generated_at)} NPT
              {insight.insight_type && ` · ${INSIGHT_TYPE_LABELS[insight.insight_type] ?? insight.insight_type}`}
            </div>
          )}
        </>
      )}

      {/* ----------- PREDICTIONS VIEW ----------- */}
      {mainView === 'predictions' && (
        <>
          <div className="flex items-center gap-1.5 mb-3 shrink-0">
            {['pending', 'confirmed', 'invalidated', 'all'].map(f => (
              <button
                key={f}
                onClick={() => setPredFilter(f === 'all' ? '' : f)}
                className={`px-2 py-1 text-xs rounded border transition-colors capitalize ${
                  (f === 'all' ? predFilter === '' : predFilter === f)
                    ? 'bg-slate-600 border-slate-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
                }`}
              >{f}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            {memoryLoading ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-12 bg-slate-800 rounded" />
                <div className="h-12 bg-slate-800 rounded" />
                <div className="h-12 bg-slate-800 rounded" />
              </div>
            ) : predictions.length === 0 ? (
              <p className="text-slate-500 text-sm py-4 text-center">
                No predictions tracked yet. Predictions appear as the AI generates insights.
              </p>
            ) : (
              predictions.map(p => (
                <div
                  key={p.id}
                  className={`p-3 rounded border text-xs ${STATUS_COLORS[p.status] || STATUS_COLORS.pending}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-slate-200 leading-relaxed flex-1">{p.prediction_text}</p>
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold tracking-wider bg-slate-700/50">
                      {p.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-slate-500">
                    <span>Made: {p.prediction_date}</span>
                    {p.target_date && <span>Target: {p.target_date}</span>}
                    {p.symbol && <span className="text-blue-400">{p.symbol}</span>}
                    {p.category && <span>{p.category.replace('_', ' ')}</span>}
                  </div>
                  {p.resolution_text && (
                    <p className="mt-1.5 text-slate-400 italic">{p.resolution_text}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ----------- OBSERVATIONS VIEW ----------- */}
      {mainView === 'observations' && (
        <div className="flex-1 overflow-y-auto space-y-1.5">
          {memoryLoading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-8 bg-slate-800 rounded" />
              <div className="h-8 bg-slate-800 rounded" />
              <div className="h-8 bg-slate-800 rounded" />
            </div>
          ) : observations.length === 0 ? (
            <p className="text-slate-500 text-sm py-4 text-center">
              No observations yet. The AI logs observations with every insight it generates.
            </p>
          ) : (
            observations.map(o => (
              <div key={o.id} className="px-3 py-2 rounded bg-slate-800/50 border border-slate-700/40">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">
                    {o.category}
                  </span>
                  {o.subcategory && (
                    <span className="text-[10px] text-slate-600">{o.subcategory.replace('_', ' ')}</span>
                  )}
                  {o.symbol && <span className="text-[10px] text-blue-400">{o.symbol}</span>}
                  <span className="ml-auto text-[10px] text-slate-600">{o.observation_date}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{o.observation}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* ----------- PATTERNS VIEW ----------- */}
      {mainView === 'patterns' && (
        <div className="flex-1 overflow-y-auto space-y-2">
          {memoryLoading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-16 bg-slate-800 rounded" />
              <div className="h-16 bg-slate-800 rounded" />
            </div>
          ) : patterns.length === 0 ? (
            <p className="text-slate-500 text-sm py-4 text-center">
              No patterns identified yet. The AI discovers patterns as it accumulates market observations over time.
            </p>
          ) : (
            patterns.map(p => (
              <div key={p.id} className="p-3 rounded border border-slate-700/50 bg-slate-800/40">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h4 className="text-xs font-semibold text-slate-200">{p.pattern_name}</h4>
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ${
                    p.status === 'established' ? 'bg-green-900/40 text-green-400' :
                    p.status === 'emerging' ? 'bg-blue-900/40 text-blue-400' :
                    'bg-slate-700/50 text-slate-500'
                  }`}>
                    {p.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-2">{p.description}</p>
                <div className="flex items-center gap-3 text-[10px] text-slate-600">
                  <TipLabel label={`Seen: ${p.evidence_count}`} tip="Times the AI reported seeing this pattern" />
                  <TipLabel
                    label={p.test_count ? `Tests: ${p.confirmation_count}/${p.test_count} right` : 'Untested'}
                    tip="Predictions based on this pattern that were graded, and how many came true when a no-change forecast would have missed"
                  />
                  <span>{p.category.replace('_', ' ')}</span>
                  {p.last_observed && <span>Last seen: {p.last_observed}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
