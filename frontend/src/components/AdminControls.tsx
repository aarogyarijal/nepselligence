'use client'

import { useState, useEffect, useRef } from 'react'
import { fetchAdminStatus, runAdminAction } from '@/lib/api'

interface DbStatus {
  stock_prices: number
  market_summary: number
  ai_insights: number
}

type ActionKey = 'prices' | 'summary' | 'insight'

const ACTIONS: { key: ActionKey; label: string; endpoint: string; description: string }[] = [
  { key: 'prices', label: 'Ingest Prices', endpoint: '/api/admin/run/ingest-prices', description: 'Pull live stock prices from NepseAPI' },
  { key: 'summary', label: 'Ingest Index', endpoint: '/api/admin/run/ingest-summary', description: 'Pull NEPSE index + market summary' },
  { key: 'insight', label: 'Generate Insight', endpoint: '/api/admin/run/generate-insight', description: 'Run Claude analysis on current market data' },
]

interface AdminControlsProps {
  forceExpand?: boolean
}

export default function AdminControls({ forceExpand = false }: AdminControlsProps) {
  const [expanded, setExpanded] = useState(false)
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null)
  const [running, setRunning] = useState<Record<ActionKey, boolean>>({ prices: false, summary: false, insight: false })
  const [results, setResults] = useState<Record<ActionKey, string | null>>({ prices: null, summary: null, insight: null })
  const [backfilling, setBackfilling] = useState(false)
  const [backfillDays, setBackfillDays] = useState(365)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

  const fetchStatus = async () => {
    const status = await fetchAdminStatus()
    if (status) setDbStatus(status)
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  // Auto-expand if DB is empty (first run) or forced
  useEffect(() => {
    if (forceExpand) setExpanded(true)
    else if (dbStatus && dbStatus.stock_prices === 0 && dbStatus.market_summary === 0) {
      setExpanded(true)
    }
  }, [dbStatus, forceExpand])

  const runAction = async (action: typeof ACTIONS[number]) => {
    setRunning(prev => ({ ...prev, [action.key]: true }))
    setResults(prev => ({ ...prev, [action.key]: null }))
    try {
      const data = await runAdminAction(action.endpoint)
      setResults(prev => ({ ...prev, [action.key]: data.ok ? 'Done' : `Error: ${data.error}` }))
      fetchStatus()
    } catch {
      setResults(prev => ({ ...prev, [action.key]: 'Failed to reach backend' }))
    } finally {
      setRunning(prev => ({ ...prev, [action.key]: false }))
    }
  }

  const startPolling = () => {
    if (pollRef.current) return
    pollRef.current = setInterval(fetchStatus, 2000)
  }

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const runBackfill = async () => {
    setBackfilling(true)
    try {
      await fetch(`${API_URL}/api/admin/run/backfill?days=${backfillDays}`, { method: 'POST', mode: 'cors' })
      startPolling()
      setTimeout(() => { stopPolling(); setBackfilling(false); fetchStatus() }, 5 * 60 * 1000)
    } catch {
      setBackfilling(false)
    }
  }

  const isEmpty = dbStatus && dbStatus.stock_prices === 0 && dbStatus.market_summary === 0

  return (
    <div className="border-t border-slate-800 bg-slate-950">
      {/* Toggle bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-2 text-xs text-slate-500 hover:text-slate-400 transition-colors"
        aria-expanded={expanded}
        aria-controls="admin-controls-panel"
      >
        <div className="flex items-center gap-3">
          <span>⚙ Admin</span>
          {dbStatus && (
            <span className="text-slate-600">
              {dbStatus.stock_prices.toLocaleString()} prices · {dbStatus.market_summary.toLocaleString()} index rows · {dbStatus.ai_insights} insights
            </span>
          )}
          {isEmpty && <span className="text-yellow-500 font-medium">No data — run ingest to get started</span>}
        </div>
        <span>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Controls panel */}
      {expanded && (
        <div id="admin-controls-panel" className="px-6 pb-4 pt-2 border-t border-slate-800">
          {isEmpty && (
            <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-800/40 rounded text-xs text-yellow-300">
              Welcome to NEPSE Dashboard. No market data yet. Click &ldquo;Ingest Prices&rdquo; and &ldquo;Ingest Index&rdquo; to get started.
            </div>
          )}

          <div className="flex flex-wrap gap-3 mb-3">
            {ACTIONS.map(action => (
              <div key={action.key} className="flex items-center gap-2">
                <button
                  onClick={() => runAction(action)}
                  disabled={running[action.key]}
                  title={action.description}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    running[action.key]
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                      : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                  }`}
                >
                  {running[action.key] ? (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                      {action.label}
                    </span>
                  ) : action.label}
                </button>
                {results[action.key] && (
                  <span className={`text-xs ${results[action.key]?.startsWith('Error') || results[action.key] === 'Failed to reach backend' ? 'text-red-400' : 'text-green-400'}`}>
                    {results[action.key]}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-slate-700/50">
            <span className="text-xs text-slate-500">Backfill history:</span>
            <select
              value={backfillDays}
              onChange={e => setBackfillDays(Number(e.target.value))}
              disabled={backfilling}
              className="bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1"
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>1 year</option>
            </select>
            <button
              onClick={runBackfill}
              disabled={backfilling}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                backfilling ? 'bg-blue-900 text-blue-300 cursor-not-allowed' : 'bg-blue-800 hover:bg-blue-700 text-blue-100'
              }`}
            >
              {backfilling ? (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />
                  Backfilling… ({dbStatus?.stock_prices.toLocaleString() ?? '0'} rows)
                </span>
              ) : 'Load History'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
