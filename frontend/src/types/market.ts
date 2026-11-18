// Shared TypeScript interfaces for NEPSE market data

export type TimeInterval = '1min' | '5min' | '15min' | '30min' | '1H' | '4H' | '1D'

export const VALID_INTERVALS: Record<string, TimeInterval[]> = {
  'today':    ['1min', '5min', '15min', '30min', '1H'],
  'last_day': ['1min', '5min', '15min', '30min', '1H'],
  '5D':  ['5min', '15min', '30min', '1H', '4H'],
  '1M':  ['15min', '30min', '1H', '4H', '1D'],
  '3M':  ['1H', '4H', '1D'],
  '6M':  ['4H', '1D'],
  '1Y':  ['1D'],
}

export const DEFAULT_INTERVAL: Record<string, TimeInterval> = {
  'today': '1min', 'last_day': '1min', '5D': '15min', '1M': '1H',
  '3M': '1D', '6M': '1D', '1Y': '1D',
}

export interface StockChartPoint {
  time: string
  value?: number
  change?: number
  changePct?: number
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number
}

export interface StockChartResponse {
  type: 'line' | 'ohlcv'
  interval: TimeInterval
  range: string
  data: StockChartPoint[]
}

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

export type AnomalyType = 'volumeSpike' | 'bigAmount' | 'priceDeviation'

export interface FloorsheetRow {
  contractNo: number
  symbol: string
  buyer: string
  seller: string
  quantity: number
  rate: number
  amount: number
  time: string
  anomalies: AnomalyType[]
}

export interface FloorsheetAnalytics {
  totalTrades: number
  totalVolume: number
  totalTurnover: number
  vwap: number
  medianTradeSize: number
  avgTradeSize: number
  maxTradeSize: number
  rateStddev: number
  priceRange: { high: number; low: number }
  anomalyThresholds: {
    volumeSpike: number
    bigAmount: number
    priceDeviation: number
  }
}

export interface FloorsheetResponse {
  symbol: string
  trades: FloorsheetRow[]
  analytics: FloorsheetAnalytics | null
}

export interface MarketFloorsheetSummary {
  date: string
  totalTrades: number
  totalTurnover: number
  avgTradeSize: number | null
  topByTurnover: { symbol: string; turnover: number; trades: number; vwap: number | null }[]
  topByTrades: { symbol: string; trades: number; turnover: number }[]
  blockLeaders: { symbol: string; blockCount: number; blockTurnover: number; blockPct: number }[]
  tradeSizeProfile: { bucket: string; trades: number; turnover: number; tradePct: number; turnoverPct: number }[]
}

export interface IntradayPoint {
  time: string
  value: number
  volume?: number
  change: number
  changePct: number
}

export type SectorIntradayData = Record<string, IntradayPoint[]>

export type FreshnessState = 'fresh' | 'aging' | 'stale'

export interface StockInsight {
  insight_text: string
  insight_type: string
  symbol: string
  generated_at: string
  extra_data?: Record<string, unknown>
}

export interface StockChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export type InsightHorizon = 'short_term' | 'medium_term' | 'long_term'
export type InsightSignal = 'trend' | 'momentum' | 'volume' | 'volatility' | 'relperf'
export type InsightGoal = 'neutral' | 'entry' | 'exit' | 'risk'
export type MarketFocus = 'index' | 'sectors' | 'breadth' | 'movers'
export type InsightDepth = 'brief' | 'detailed'

export interface StockInsightOptions {
  horizon: InsightHorizon
  signals: InsightSignal[]
  goal: InsightGoal
}

export interface MarketInsightOptions {
  depth: InsightDepth
  focus: MarketFocus[]
}

export interface NewsArticle {
  id: number
  title: string
  link: string
  summary: string | null
  source: string
  published_at: string
  fetched_at: string
  symbols: string[]
  category: string
}

export type NewsCategory = 'all' | 'market' | 'dividend' | 'ipo' | 'corporate' | 'policy' | 'general'

// ---------------------------------------------------------------------------
// AI Memory System types
// ---------------------------------------------------------------------------

export interface AIPrediction {
  id: number
  prediction_date: string
  target_date: string | null
  category: string
  symbol: string | null
  sector: string | null
  prediction_text: string
  conditions: Record<string, unknown> | null
  reference_values: Record<string, unknown> | null
  status: 'pending' | 'confirmed' | 'invalidated' | 'expired' | 'partially_confirmed'
  resolution_text: string | null
  resolved_at: string | null
  outcome_values: Record<string, unknown> | null
}

export interface AIObservation {
  id: number
  observation_date: string
  category: string
  subcategory: string | null
  symbol: string | null
  sector: string | null
  observation: string
  data_snapshot: Record<string, unknown> | null
  confidence: string
}

export interface AIMarketRegime {
  date: string
  trend: string
  trend_strength: string | null
  volatility_regime: string | null
  breadth_health: string | null
  leading_sectors: string[]
  lagging_sectors: string[]
  nepse_index: number | null
  key_levels: Record<string, number> | null
  regime_duration_days: number
  notes: string | null
}

export interface AIPattern {
  id: number
  pattern_name: string
  description: string
  category: string
  evidence_count: number
  confirmation_count: number
  last_observed: string | null
  last_confirmed: string | null
  status: string
}

export interface AIPredictionScorecard {
  total: number
  confirmed: number
  partially_confirmed: number
  invalidated: number
  expired: number
  hit_rate_pct: number
  /** Hit rate of a forecaster who assumes nothing changes, on the same predictions. */
  baseline_hit_rate_pct?: number | null
  /** Points by which the AI beats (or trails) that baseline. */
  edge_pct?: number | null
}

export interface AIMemorySummary {
  id: number
  period_type: string
  period_start: string
  period_end: string
  summary_text: string
  key_events: string[]
  prediction_scorecard: Record<string, number> | null
  market_regime_summary: Record<string, unknown> | null
  sector_performance: Record<string, number> | null
  notable_stocks: string[]
  created_at: string
}

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
    vwap: number | null
    avgTradeSize: number | null
    medianTradeSize: number | null
    totalTrades: number
    totalTurnover: number | null
    maxTradeSize: number | null
    blockTrades: {
      count: number
      turnover: number
      avgSize?: number
    } | null
    sizeDistribution: { bucket: string; trades: number; turnover: number }[]
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
