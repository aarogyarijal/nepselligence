// Typed fetch wrappers for all backend endpoints

import type {
  ApiEnvelope,
  MarketOverview,
  SectorData,
  TopMover,
  TurnoverLeader,
  MarketBreadth,
  OHLCVPoint,
  Company,
  AIInsight,
  FloorsheetResponse,
  MarketFloorsheetSummary,
  StockAnalysis,
  IntradayPoint,
  SectorIntradayData,
  StockChartResponse,
  StockInsight,
  StockChatMessage,
  StockInsightOptions,
  MarketInsightOptions,
  NewsArticle,
} from '@/types/market'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

// In-flight request deduplication: if the same GET path is already pending,
// return the same promise rather than firing a second network request.
const _pending = new Map<string, Promise<unknown>>()

async function get<T>(path: string): Promise<ApiEnvelope<T>> {
  if (_pending.has(path)) return _pending.get(path) as Promise<ApiEnvelope<T>>
  const promise = fetch(`${API_URL}${path}`, { mode: 'cors' })
    .then(res => {
      if (!res.ok) throw new Error(`${path} → ${res.status}`)
      return res.json() as Promise<ApiEnvelope<T>>
    })
    .finally(() => _pending.delete(path))
  _pending.set(path, promise)
  return promise
}

export async function fetchMarketOverview(): Promise<ApiEnvelope<MarketOverview | null>> {
  return get('/api/market/overview')
}

export async function fetchSectors(range = 'today'): Promise<ApiEnvelope<SectorData[]>> {
  return get(`/api/market/sectors?range=${range}`)
}

export async function fetchTopGainers(range = 'today'): Promise<ApiEnvelope<TopMover[]>> {
  return get(`/api/market/top-gainers?range=${range}`)
}

export async function fetchTopLosers(range = 'today'): Promise<ApiEnvelope<TopMover[]>> {
  return get(`/api/market/top-losers?range=${range}`)
}

export async function fetchTopTurnover(range = 'today'): Promise<ApiEnvelope<TurnoverLeader[]>> {
  return get(`/api/market/top-turnover?range=${range}`)
}

export async function fetchMarketBreadth(range = 'today'): Promise<ApiEnvelope<MarketBreadth | null>> {
  return get(`/api/market/breadth?range=${range}`)
}

export async function fetchCompanies(): Promise<ApiEnvelope<Company[]>> {
  return get('/api/market/companies')
}

export async function fetchStockHistory(symbol: string): Promise<ApiEnvelope<OHLCVPoint[]>> {
  return get(`/api/stocks/${encodeURIComponent(symbol)}/history`)
}

export async function fetchStockAnalysis(symbol: string): Promise<ApiEnvelope<StockAnalysis | null>> {
  return get(`/api/stocks/${encodeURIComponent(symbol)}/analysis`)
}

export async function fetchIndexHistory(range: string, interval = ''): Promise<{ time: string; value: number }[]> {
  const params = new URLSearchParams({ range })
  if (interval) params.set('interval', interval)
  const res = await fetch(`${API_URL}/api/index/history?${params}`, { mode: 'cors' })
  if (!res.ok) return []
  return res.json()
}

export async function fetchStockChart(symbol: string, range: string, interval = ''): Promise<StockChartResponse> {
  const params = new URLSearchParams({ range })
  if (interval) params.set('interval', interval)
  const res = await fetch(`${API_URL}/api/stocks/${encodeURIComponent(symbol)}/chart?${params}`, { mode: 'cors' })
  if (!res.ok) return { type: 'line', interval: interval as StockChartResponse['interval'] || '1min', range, data: [] }
  return res.json()
}

export async function fetchLatestInsight(type?: string): Promise<AIInsight | null> {
  const url = type
    ? `${API_URL}/api/insights/latest?type=${type}`
    : `${API_URL}/api/insights/latest`
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) return null
  return res.json()
}

export async function fetchInsightHistory(limit = 10): Promise<AIInsight[]> {
  const res = await fetch(`${API_URL}/api/insights/history?limit=${limit}`, { mode: 'cors' })
  if (!res.ok) return []
  return res.json()
}

export async function fetchFloorsheet(symbol: string, limit = 200, days = 1): Promise<FloorsheetResponse> {
  const res = await fetch(
    `${API_URL}/api/stocks/${encodeURIComponent(symbol)}/floorsheet?limit=${limit}&days=${days}`,
    { mode: 'cors' }
  )
  if (!res.ok) return { symbol, trades: [], analytics: null }
  return res.json()
}

export async function fetchMarketFloorsheetSummary(date?: string): Promise<MarketFloorsheetSummary | null> {
  const url = date
    ? `${API_URL}/api/market/floorsheet-summary?date=${date}`
    : `${API_URL}/api/market/floorsheet-summary`
  const res = await fetch(url, { mode: 'cors' })
  if (!res.ok) return null
  return res.json()
}

export async function fetchStockIntraday(symbol: string): Promise<IntradayPoint[]> {
  const res = await fetch(
    `${API_URL}/api/stocks/${encodeURIComponent(symbol)}/intraday`,
    { mode: 'cors' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function fetchSectorsIntraday(range = 'today', interval = ''): Promise<SectorIntradayData> {
  const params = new URLSearchParams({ range })
  if (interval) params.set('interval', interval)
  const res = await fetch(`${API_URL}/api/sectors/intraday?${params}`, { mode: 'cors' })
  if (!res.ok) return {}
  return res.json()
}

export async function fetchAdminStatus(): Promise<{
  stock_prices: number
  market_summary: number
  ai_insights: number
} | null> {
  const res = await fetch(`${API_URL}/api/admin/status`, { mode: 'cors' })
  if (!res.ok) return null
  return res.json()
}

export async function runAdminAction(endpoint: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_URL}${endpoint}`, { method: 'POST', mode: 'cors' })
  return res.json()
}

export async function fetchStockInsight(symbol: string): Promise<StockInsight | null> {
  const res = await fetch(
    `${API_URL}/api/stocks/${encodeURIComponent(symbol)}/insight/latest`,
    { mode: 'cors' }
  )
  if (!res.ok) return null
  return res.json()
}

export async function generateStockInsight(
  symbol: string,
  options?: StockInsightOptions
): Promise<StockInsight> {
  const res = await fetch(
    `${API_URL}/api/stocks/${encodeURIComponent(symbol)}/insight`,
    {
      method: 'POST',
      mode: 'cors',
      headers: options ? { 'Content-Type': 'application/json' } : undefined,
      body: options ? JSON.stringify({ options }) : undefined,
    }
  )
  if (!res.ok) throw new Error(`Failed to generate insight: ${res.status}`)
  return res.json()
}

export async function generateMarketInsight(
  type = 'daily_close',
  options?: MarketInsightOptions
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_URL}/api/admin/run/generate-insight?type=${type}`, {
    method: 'POST',
    mode: 'cors',
    headers: options ? { 'Content-Type': 'application/json' } : undefined,
    body: options ? JSON.stringify({ options }) : undefined,
  })
  return res.json()
}

export async function fetchNews(params?: {
  symbol?: string
  category?: string
  limit?: number
  offset?: number
}): Promise<{ data: NewsArticle[]; meta: { total: number; limit: number; offset: number } }> {
  const p = new URLSearchParams()
  if (params?.symbol) p.set('symbol', params.symbol)
  if (params?.category && params.category !== 'all') p.set('category', params.category)
  if (params?.limit) p.set('limit', String(params.limit))
  if (params?.offset) p.set('offset', String(params.offset))
  const qs = p.toString()
  const res = await fetch(`${API_URL}/api/news${qs ? `?${qs}` : ''}`, { mode: 'cors' })
  if (!res.ok) return { data: [], meta: { total: 0, limit: 20, offset: 0 } }
  return res.json()
}

export async function fetchStockNews(symbol: string, limit = 10): Promise<NewsArticle[]> {
  const res = await fetch(
    `${API_URL}/api/stocks/${encodeURIComponent(symbol)}/news?limit=${limit}`,
    { mode: 'cors' }
  )
  if (!res.ok) return []
  const data = await res.json()
  return data.data ?? []
}

export async function chatWithStock(
  symbol: string,
  messages: StockChatMessage[]
): Promise<string> {
  const res = await fetch(
    `${API_URL}/api/stocks/${encodeURIComponent(symbol)}/chat`,
    {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    }
  )
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`)
  const data = await res.json()
  return data.response ?? ''
}
