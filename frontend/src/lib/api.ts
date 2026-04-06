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
  StockAnalysis,
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

export async function fetchIndexHistory(range: string): Promise<{ time: string; value: number }[]> {
  const res = await fetch(`${API_URL}/api/index/history?range=${range}`, { mode: 'cors' })
  if (!res.ok) return []
  return res.json()
}

export async function fetchLatestInsight(): Promise<AIInsight | null> {
  const res = await fetch(`${API_URL}/api/insights/latest`, { mode: 'cors' })
  if (!res.ok) return null
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
