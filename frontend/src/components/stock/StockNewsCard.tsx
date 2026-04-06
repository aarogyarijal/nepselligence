'use client'

import { useState, useCallback, useEffect } from 'react'
import { fetchStockNews } from '@/lib/api'
import { usePolling } from '@/hooks/usePolling'
import type { NewsArticle } from '@/types/market'

const CATEGORY_COLORS: Record<string, string> = {
  dividend: 'text-emerald-400 bg-emerald-900/30',
  ipo: 'text-blue-400 bg-blue-900/30',
  market: 'text-amber-400 bg-amber-900/30',
  policy: 'text-purple-400 bg-purple-900/30',
  corporate: 'text-sky-400 bg-sky-900/30',
  general: 'text-slate-400 bg-slate-800',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface StockNewsCardProps {
  symbol: string
}

export default function StockNewsCard({ symbol }: StockNewsCardProps) {
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const data = await fetchStockNews(symbol, 8)
      setArticles(data)
    } catch {
      // retain stale data silently
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => {
    load()
  }, [load])

  // Poll every 10 min for stock-specific news (less urgent than market feed)
  usePolling(load, 10 * 60_000, true)

  if (!loading && articles.length === 0) {
    return null
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-700">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          News — {symbol}
        </h2>
      </div>

      {loading ? (
        <div className="p-5 space-y-4 animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 bg-slate-700 rounded w-20" />
              <div className="h-4 bg-slate-700 rounded w-full" />
              <div className="h-3 bg-slate-700 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-slate-800">
          {articles.map(article => {
            const categoryClass = CATEGORY_COLORS[article.category] ?? CATEGORY_COLORS.general
            return (
              <div key={article.id} className="px-5 py-4 hover:bg-slate-800/40 transition-colors">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${categoryClass}`}>
                    {article.category}
                  </span>
                  <span className="text-xs text-slate-600">{timeAgo(article.published_at)}</span>
                  <span className="text-xs text-slate-700">·</span>
                  <span className="text-xs text-slate-600">{article.source}</span>
                </div>
                <a
                  href={article.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-slate-200 hover:text-white leading-snug block transition-colors"
                >
                  {article.title}
                </a>
                {article.summary && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {article.summary}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
