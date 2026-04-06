'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { fetchNews } from '@/lib/api'
import { usePolling } from '@/hooks/usePolling'
import type { NewsArticle, NewsCategory } from '@/types/market'

const CATEGORIES: { label: string; value: NewsCategory }[] = [
  { label: 'All', value: 'all' },
  { label: 'Market', value: 'market' },
  { label: 'Dividend', value: 'dividend' },
  { label: 'IPO/FPO', value: 'ipo' },
  { label: 'Corporate', value: 'corporate' },
  { label: 'Policy', value: 'policy' },
]

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

interface NewsItemProps {
  article: NewsArticle
  onSymbolClick: (symbol: string) => void
}

function NewsItem({ article, onSymbolClick }: NewsItemProps) {
  const categoryClass = CATEGORY_COLORS[article.category] ?? CATEGORY_COLORS.general

  return (
    <div className="py-3 px-4 hover:bg-slate-800/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${categoryClass}`}>
              {article.category}
            </span>
            <span className="text-xs text-slate-600">{timeAgo(article.published_at)}</span>
            {article.symbols.slice(0, 3).map(sym => (
              <button
                key={sym}
                onClick={() => onSymbolClick(sym)}
                className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-colors font-mono"
              >
                {sym}
              </button>
            ))}
            {article.symbols.length > 3 && (
              <span className="text-xs text-slate-600">+{article.symbols.length - 3}</span>
            )}
          </div>
          <a
            href={article.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-slate-200 hover:text-white leading-snug line-clamp-2 transition-colors"
          >
            {article.title}
          </a>
        </div>
      </div>
    </div>
  )
}

export default function NewsFeed() {
  const router = useRouter()
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState<NewsCategory>('all')

  const load = useCallback(async () => {
    try {
      const result = await fetchNews({ category, limit: 12 })
      setArticles(result.data)
    } catch {
      // silently retain stale data
    } finally {
      setLoading(false)
    }
  }, [category])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  usePolling(load, 5 * 60_000, true)

  const handleSymbolClick = (sym: string) => {
    router.push(`/stock/${sym}`)
  }

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Market News</h2>
          <span className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded">ShareSansar</span>
        </div>
        {/* Category filter tabs */}
        <div className="flex gap-1">
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                category === cat.value
                  ? 'bg-blue-900/60 text-blue-300'
                  : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Articles */}
      <div className="divide-y divide-slate-800">
        {loading ? (
          <div className="px-4 py-6 space-y-3 animate-pulse">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 bg-slate-700 rounded w-24" />
                <div className="h-4 bg-slate-700 rounded w-full" />
                <div className="h-4 bg-slate-700 rounded w-4/5" />
              </div>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 text-center">
            {category === 'all' ? 'No news yet — trigger ingestion from Admin controls.' : `No ${category} news available.`}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {articles.map(article => (
              <NewsItem
                key={article.id}
                article={article}
                onSymbolClick={handleSymbolClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
