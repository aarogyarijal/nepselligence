'use client'

import { useEffect, useState, useCallback } from 'react'
import { fetchLatestInsight, fetchInsightHistory, generateMarketInsight } from '@/lib/api'
import { useFreshness } from '@/hooks/useFreshness'
import { usePolling } from '@/hooks/usePolling'
import { formatNPT } from '@/lib/format'
import type { AIInsight, InsightType, MarketInsightOptions, MarketFocus, InsightDepth } from '@/types/market'

type Tab = 'Summary' | 'Signals' | 'Anomalies'
const TABS: Tab[] = ['Summary', 'Signals', 'Anomalies']

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

interface AIPanelProps {
  isOpen: boolean
}

export default function AIPanel({ isOpen }: AIPanelProps) {
  const [insight, setInsight] = useState<AIInsight | null>(null)
  const [history, setHistory] = useState<AIInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('Summary')
  const [showHistory, setShowHistory] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genType, setGenType] = useState<InsightType>('daily_close')
  const [genOptions, setGenOptions] = useState<MarketInsightOptions>({
    depth: 'detailed',
    focus: ['index', 'sectors', 'breadth', 'movers'],
  })

  const load = useCallback(async () => {
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

  useEffect(() => { load() }, [load])
  usePolling(load, isOpen ? 60_000 : 300_000, true)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      await generateMarketInsight(genType, genOptions)
      await load()
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

  // History items excluding the currently displayed insight
  const otherInsights = history.filter(h => h.generated_at !== insight?.generated_at)

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-700 p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-xl font-semibold text-white">AI Insights</h2>
          <span className="text-xs px-2 py-0.5 bg-blue-900/60 text-blue-300 rounded">Claude</span>
          {insight?.insight_type && (
            <span className="text-xs px-2 py-0.5 bg-slate-700 text-slate-300 rounded">
              {INSIGHT_TYPE_LABELS[insight.insight_type] ?? insight.insight_type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
              {showHistory ? 'Hide' : `+${otherInsights.length} earlier`}
            </button>
          )}
          <button
            onClick={() => setShowGenerate(v => !v)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
              showGenerate
                ? 'bg-slate-700 border-slate-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            ⚙ Generate
          </button>
        </div>
      </div>

      {/* Generate options panel */}
      {showGenerate && (
        <div className="mb-3 p-3 border border-slate-700 rounded-lg bg-slate-800/60 space-y-3 shrink-0">
          {/* Type */}
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
          {/* Depth */}
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
          {/* Focus */}
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
        <div className="mb-3 shrink-0 border border-slate-700 rounded bg-slate-800/60 divide-y divide-slate-700/60">
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
                <span className="text-xs text-slate-500">{formatNPT(h.generated_at)} NPT</span>
              </div>
              <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                {h.insight_text.slice(0, 120)}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      {!loading && !error && hasSections && (
        <div
          className="flex gap-4 border-b border-slate-700 mb-4 shrink-0"
          role="tablist"
          aria-label="AI insight sections"
        >
          {TABS.map(tab => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              onKeyDown={e => {
                const idx = TABS.indexOf(tab)
                if (e.key === 'ArrowRight') setActiveTab(TABS[(idx + 1) % TABS.length])
                if (e.key === 'ArrowLeft') setActiveTab(TABS[(idx - 1 + TABS.length) % TABS.length])
              }}
              className={`pb-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading || generating ? (
          <div className="space-y-2 animate-pulse">
            {generating && (
              <p className="text-xs text-blue-400 mb-3 not-italic">Generating insight with Claude…</p>
            )}
            <div className="h-4 bg-slate-700 rounded w-full" />
            <div className="h-4 bg-slate-700 rounded w-5/6" />
            <div className="h-4 bg-slate-700 rounded w-4/6" />
            <div className="h-4 bg-slate-700 rounded w-3/4" />
            <div className="h-4 bg-slate-700 rounded w-full" />
            <div className="h-4 bg-slate-700 rounded w-2/3" />
          </div>
        ) : error ? (
          <p className="text-slate-400 text-sm">Analysis unavailable — check pipeline status.</p>
        ) : !insight ? (
          <p className="text-slate-500 text-sm">No insights yet. Generate one from Admin controls.</p>
        ) : (
          <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
            {getTabContent() || insight.insight_text}
          </p>
        )}
      </div>

      {/* Footer */}
      {insight && (
        <div className="mt-4 pt-3 border-t border-slate-700 text-xs text-slate-600 shrink-0">
          Generated {formatNPT(insight.generated_at)} NPT · For informational purposes only
        </div>
      )}
    </div>
  )
}
