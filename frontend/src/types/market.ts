// Shared TypeScript interfaces for NEPSE market data

export interface ApiEnvelope<T> {
  data: T
  meta: {
    source: 'live' | 'cache' | 'db' | 'none'
    asOf: string
    stale: boolean
    partial?: boolean
    errors?: string[]
  }
}

export interface MarketIndex {
  name: string
  value: number
  change: number
  changePct: number
}

export interface MarketSummary {
  totalTurnover: number
  totalShares: number
  totalTransactions: number
}

export interface MarketOverview {
  isOpen: boolean
  indices: MarketIndex[]
  summary: MarketSummary
  lastUpdated: string
}

export interface SectorData {
  name: string
  value: number
  change: number
  changePct: number
}

export interface TopMover {
  rank: number
  symbol: string
  ltp: number
  change: number
  changePct: number
  turnover?: number
}

export interface TurnoverLeader {
  rank: number
  symbol: string
  ltp: number
  turnover: number
}

export interface MarketBreadth {
  advances: number
  declines: number
  unchanged: number
  total: number
  adRatio: number | null
}

export interface OHLCVPoint {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  turnover: number | null
}

export interface Company {
  symbol: string
  name: string
}

export interface AIInsight {
  insight_text: string
  generated_at: string
  extra_data?: Record<string, unknown>
}

export type FreshnessState = 'fresh' | 'aging' | 'stale'
