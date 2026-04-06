'use client'

import { useEffect, useState, useCallback } from 'react'
import { fetchLatestInsight } from '@/lib/api'
import { useFreshness } from '@/hooks/useFreshness'
import { usePolling } from '@/hooks/usePolling'
import { formatNPT } from '@/lib/format'
import type { AIInsight } from '@/types/market'

type Tab = 'Summary' | 'Signals' | 'Anomalies'
const TABS: Tab[] = ['Summary', 'Signals', 'Anomalies']

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

interface AIPanelProps {
  isOpen: boolean
}

export default function AIPanel({ isOpen }: AIPanelProps) {
  const [insight, setInsight] = useState<AIInsight | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('Summary')

  const load = useCallback(async () => {
    try {
      const data = await fetchLatestInsight()
      setInsight(data)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  usePolling(load, 300_000, true) // poll every 5 min regardless of market status

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

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-700 p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-white">AI Insights</h2>
          <span className="text-xs px-2 py-0.5 bg-blue-900/60 text-blue-300 rounded">
            Claude
          </span>
        </div>
        {freshness !== 'fresh' && insight && (
          <span className={`text-xs ${freshness === 'aging' ? 'text-yellow-400' : 'text-slate-500'}`}>
            {freshnessLabel(freshness, insight.generated_at)}
          </span>
        )}
      </div>

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
        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-4 bg-slate-700 rounded w-full" />
            <div className="h-4 bg-slate-700 rounded w-5/6" />
            <div className="h-4 bg-slate-700 rounded w-4/6" />
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
