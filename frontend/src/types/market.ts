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

export type InsightType = 'market_open' | 'hourly' | 'daily_close' | 'weekly_wrap'

export interface AIInsight {
  insight_text: string
  insight_type: InsightType
  generated_at: string
  extra_data?: Record<string, unknown>
}

export interface FloorsheetRow {
  symbol: string
  buyer: string
  seller: string
  quantity: number
  rate: number
  time: string
}

export type FreshnessState = 'fresh' | 'aging' | 'stale'

export interface StockAnalysis {
  symbol: string
  name: string | null
  sector: string | null
  price: {
    ltp: number
    change: number | null
    changePct: number | null
    high52w: number
    low52w: number
    allTimeHigh: number
    rangePosition: number
    prevClose: number | null
  }
  returns: Record<string, number | null>
  technicals: {
    sma20: number | null
    sma50: number | null
    sma200: number | null
    ema12: number | null
    ema26: number | null
    rsi14: number | null
    macd: { macd: number; signal: number; histogram: number } | null
    bollingerBands: { upper: number; middle: number; lower: number } | null
    atr14: number | null
  }
  volume: {
    latest: number | null
    avg20d: number | null
    avg90d: number | null
    volumeRatio: number | null
    avgTurnover20d: number | null
  }
  volatility: {
    daily30d: number | null
    annualized30d: number | null
    avgDailyRange20d: number | null
  }
  relativePerformance: {
    stockReturn30d: number | null
    nepseReturn30d: number | null
    alpha30d: number | null
  } | null
  floorsheet: {
    topBuyers: { broker: string; quantity: number; trades: number }[]
    topSellers: { broker: string; quantity: number; trades: number }[]
    avgTradeSize: number | null
    vwap: number | null
    totalTrades: number
  } | null
  history: OHLCVPoint[]
  overlays: {
    sma20: { date: string; value: number }[]
    sma50: { date: string; value: number }[]
    sma200: { date: string; value: number }[]
    bollingerUpper: { date: string; value: number }[]
    bollingerLower: { date: string; value: number }[]
  }
  signals: {
    trend: string | null
    momentum: string | null
    volumeTrend: string | null
    priceVsSMA: string | null
  }
}
