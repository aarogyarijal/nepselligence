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
  FloorsheetRow,
  StockAnalysis,
  IntradayPoint,
  SectorIntradayData,
  StockChartResponse,
  StockInsight,
  StockChatMessage,
} from '@/types/market'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

async function get<T>(path: string): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${API_URL}${path}`, { mode: 'cors' })
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

export async function fetchMarketOverview(): Promise<ApiEnvelope<MarketOverview | null>> {
  return get('/api/market/overview')
}

export async function fetchSectors(range = '1D'): Promise<ApiEnvelope<SectorData[]>> {
  return get(`/api/market/sectors?range=${range}`)
}

export async function fetchTopGainers(range = '1D'): Promise<ApiEnvelope<TopMover[]>> {
  return get(`/api/market/top-gainers?range=${range}`)
}

export async function fetchTopLosers(range = '1D'): Promise<ApiEnvelope<TopMover[]>> {
  return get(`/api/market/top-losers?range=${range}`)
}

export async function fetchTopTurnover(range = '1D'): Promise<ApiEnvelope<TurnoverLeader[]>> {
  return get(`/api/market/top-turnover?range=${range}`)
}

export async function fetchMarketBreadth(range = '1D'): Promise<ApiEnvelope<MarketBreadth | null>> {
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

export async function fetchFloorsheet(symbol: string, limit = 200): Promise<FloorsheetRow[]> {
  const res = await fetch(
    `${API_URL}/api/stocks/${encodeURIComponent(symbol)}/floorsheet?limit=${limit}`,
    { mode: 'cors' }
  )
  if (!res.ok) return []
  const data = await res.json()
  // endpoint returns ApiEnvelope or raw array
  return Array.isArray(data) ? data : (data.data ?? [])
}

export async function fetchStockIntraday(symbol: string): Promise<IntradayPoint[]> {
  const res = await fetch(
    `${API_URL}/api/stocks/${encodeURIComponent(symbol)}/intraday`,
    { mode: 'cors' }
  )
  if (!res.ok) return []
  return res.json()
}

export async function fetchSectorsIntraday(range = '1D', interval = ''): Promise<SectorIntradayData> {
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

export async function generateStockInsight(symbol: string): Promise<StockInsight> {
  const res = await fetch(
    `${API_URL}/api/stocks/${encodeURIComponent(symbol)}/insight`,
    { method: 'POST', mode: 'cors' }
  )
  if (!res.ok) throw new Error(`Failed to generate insight: ${res.status}`)
  return res.json()
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
