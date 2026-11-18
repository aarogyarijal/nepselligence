"""Database models for NEPSE market data."""

from datetime import datetime

from .timeutil import utc_now
from sqlalchemy import Column, Integer, BigInteger, Float, String, Text, DateTime, Date, Boolean, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB

from .database import Base


class StockPrice(Base):
    """Real-time stock prices from REST + WebSocket feeds."""

    __tablename__ = "stock_prices"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(20), nullable=False, index=True)
    ltp = Column(Float, nullable=False)  # Last traded price
    high = Column(Float)
    low = Column(Float)
    open = Column(Float)
    close = Column(Float)
    change = Column(Float)
    change_percent = Column(Float)
    volume = Column(Integer)
    turnover = Column(Float)
    time = Column(DateTime(timezone=True), nullable=False, index=True)
    source = Column(String(50), nullable=False)  # "rest" or "websocket"

    __table_args__ = (
        UniqueConstraint("time", "symbol", name="uq_price_time_symbol"),
        Index("idx_symbol_time", "symbol", "time"),
        # Covers breadth fallback query: WHERE time >= X AND ltp > 0
        Index("idx_sp_time_ltp", "time", "ltp"),
    )


class Floorsheet(Base):
    """Transaction-level floorsheet data (all trades).

    Broker identity fields (buyerMemberId, sellerBrokerName, etc.) from the NepseAPI
    are always null and are not stored. Analytics are purely trade-level.
    """

    __tablename__ = "floorsheet"

    id = Column(Integer, primary_key=True)
    contract_id = Column(BigInteger, nullable=False)   # contractId — dedup key
    symbol = Column(String(20), nullable=False, index=True)
    stock_id = Column(Integer)                          # stockId from API
    quantity = Column(Integer, nullable=False)
    rate = Column(Float, nullable=False)
    amount = Column(Float, nullable=False)              # contractAmount (rate * quantity)
    time = Column(DateTime(timezone=True), nullable=False, index=True)
    business_date = Column(Date, nullable=False)
    security_name = Column(String(200))

    __table_args__ = (
        UniqueConstraint("contract_id", name="uq_floorsheet_contract_id"),
        Index("idx_floorsheet_symbol_time", "symbol", "time"),
        Index("idx_floorsheet_symbol_date", "symbol", "business_date"),
        Index("idx_floorsheet_date", "business_date"),
        Index("idx_floorsheet_amount", "amount"),
    )


class MarketStatus(Base):
    """Daily market open/closed status (holiday guard)."""

    __tablename__ = "market_status"

    id = Column(Integer, primary_key=True)
    date = Column(DateTime(timezone=True), nullable=False, unique=True, index=True)
    is_open = Column(Integer, nullable=False)  # 1 = open, 0 = closed
    last_checked = Column(DateTime(timezone=True), nullable=False)


class MarketSummary(Base):
    """NEPSE index snapshots ingested during market hours."""

    __tablename__ = "market_summary"

    id = Column(Integer, primary_key=True)
    time = Column(DateTime(timezone=True), nullable=False, index=True)
    nepse_index = Column(Float, nullable=False)
    nepse_change = Column(Float)
    nepse_change_pct = Column(Float)
    total_turnover = Column(Float)
    total_shares = Column(Integer)
    total_transactions = Column(Integer)

    __table_args__ = (
        UniqueConstraint("time", name="uq_summary_time"),
    )


class AIInsight(Base):
    """AI-generated market insights from Claude API."""

    __tablename__ = "ai_insights"

    id = Column(Integer, primary_key=True)
    generated_at = Column(DateTime(timezone=True), nullable=False, index=True)
    insight_type = Column(String(30), nullable=False, default="daily_close")  # market_open, hourly, daily_close, weekly_wrap
    insight_text = Column(Text, nullable=False)
    symbol = Column(String(20))  # Null if market-wide insight
    extra_data = Column(JSONB)  # Any extra structured data


class DailyMarketBreadth(Base):
    """Daily market breadth: advance/decline/unchanged counts."""

    __tablename__ = "daily_market_breadth"

    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False, unique=True, index=True)
    advances = Column(Integer, nullable=False)
    declines = Column(Integer, nullable=False)
    unchanged = Column(Integer, nullable=False)
    total = Column(Integer, nullable=False)
    ad_ratio = Column(Float)  # advances / declines, null if declines == 0


class DailySectorIndex(Base):
    """Daily sector sub-index values (13 sectors)."""

    __tablename__ = "daily_sector_indices"

    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False, index=True)
    sector_name = Column(String(100), nullable=False)
    index_value = Column(Float, nullable=False)
    change = Column(Float)
    change_pct = Column(Float)

    __table_args__ = (
        UniqueConstraint("date", "sector_name", name="uq_sector_date"),
    )


class DailyTopMover(Base):
    """Daily top gainers, losers, and turnover leaders."""

    __tablename__ = "daily_top_movers"

    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False, index=True)
    category = Column(String(20), nullable=False)  # "gainer", "loser", "turnover"
    rank = Column(Integer, nullable=False)
    symbol = Column(String(20), nullable=False)
    ltp = Column(Float)
    change = Column(Float)
    change_pct = Column(Float)
    turnover = Column(Float)

    __table_args__ = (
        UniqueConstraint("date", "category", "rank", name="uq_mover_date_category_rank"),
    )


class NewsArticle(Base):
    """News articles ingested from RSS feeds and other sources."""

    __tablename__ = "news_articles"

    id = Column(Integer, primary_key=True)
    guid = Column(String(500), nullable=False, unique=True)  # RSS <guid> for deduplication
    title = Column(String(500), nullable=False)
    link = Column(String(500), nullable=False)
    summary = Column(Text)  # Cleaned text stripped of HTML tags
    source = Column(String(50), nullable=False, default="sharesansar")
    published_at = Column(DateTime(timezone=True), nullable=False, index=True)
    fetched_at = Column(DateTime(timezone=True), nullable=False)
    symbols = Column(JSONB, default=[])  # e.g. ["NABIL", "SBL"] — GIN indexed for fast containment queries
    category = Column(String(50))  # dividend, ipo, market, policy, corporate, general

    __table_args__ = (
        Index("idx_news_published", "published_at"),
        Index("idx_news_symbols", "symbols", postgresql_using="gin"),
        Index("idx_news_source", "source"),
    )


class IntradaySectorValue(Base):
    """5-minute sector index snapshots for multi-day charts."""

    __tablename__ = "intraday_sector_values"

    id = Column(Integer, primary_key=True)
    sector_name = Column(String(100), nullable=False)
    time = Column(DateTime(timezone=True), nullable=False, index=True)
    value = Column(Float, nullable=False)

    __table_args__ = (
        UniqueConstraint("sector_name", "time", name="uq_sector_intraday"),
        Index("idx_sector_intraday_time", "sector_name", "time"),
    )


# ---------------------------------------------------------------------------
# AI Memory System
# ---------------------------------------------------------------------------

class AIMarketObservation(Base):
    """Structured observations extracted from each AI insight generation."""

    __tablename__ = "ai_market_observations"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    observation_date = Column(Date, nullable=False)
    source_insight_id = Column(Integer, ForeignKey("ai_insights.id"), nullable=True)
    category = Column(String(30), nullable=False)       # market_regime, sector, stock, breadth, anomaly
    subcategory = Column(String(50))                     # momentum_shift, volume_spike, leadership_change, etc.
    symbol = Column(String(20))                          # NULL for market-wide
    sector = Column(String(100))
    observation = Column(Text, nullable=False)           # 1-2 sentence human-readable fact
    data_snapshot = Column(JSONB)                        # Key numbers at time of observation
    confidence = Column(String(10), default="medium")    # low, medium, high
    still_relevant = Column(Boolean, default=True)
    expires_at = Column(Date)

    __table_args__ = (
        Index("idx_obs_date", "observation_date"),
        Index("idx_obs_category_date", "category", "observation_date"),
        Index("idx_obs_symbol_date", "symbol", "observation_date"),
        Index("idx_obs_relevant_date", "still_relevant", "observation_date"),
    )


class AIPrediction(Base):
    """Forward-looking statements from AI insights, tracked with outcomes."""

    __tablename__ = "ai_predictions"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    source_insight_id = Column(Integer, ForeignKey("ai_insights.id"), nullable=True)
    pattern_id = Column(Integer, ForeignKey("ai_patterns.id"), nullable=True)  # pattern this prediction tests
    prediction_date = Column(Date, nullable=False)
    target_date = Column(Date)                           # When it should resolve (NULL = open-ended)
    category = Column(String(30), nullable=False)        # price_direction, sector_rotation, breakout, support_test
    symbol = Column(String(20))                          # NULL for index/market-wide
    sector = Column(String(100))
    prediction_text = Column(Text, nullable=False)
    conditions = Column(JSONB)                           # Measurable: {"metric": "rsi", "symbol": "NABIL", "direction": "below", "threshold": 60}
    reference_values = Column(JSONB)                     # Values at prediction time
    status = Column(String(20), default="pending")       # pending, confirmed, invalidated, expired, partially_confirmed
    resolution_text = Column(Text)
    resolved_at = Column(DateTime(timezone=True))
    outcome_values = Column(JSONB)                       # Values at resolution

    __table_args__ = (
        Index("idx_pred_status_date", "status", "prediction_date"),
        Index("idx_pred_symbol_status", "symbol", "status"),
        Index("idx_pred_target", "target_date"),
    )


class AIPattern(Base):
    """AI-generated hypotheses about recurring market behavior."""

    __tablename__ = "ai_patterns"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    pattern_name = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    category = Column(String(30), nullable=False)        # sector_rotation, momentum, seasonal, volume, correlation
    conditions = Column(JSONB)
    evidence_count = Column(Integer, default=1)       # times the AI reported seeing it
    test_count = Column(Integer, default=0)           # graded predictions that tested it
    confirmation_count = Column(Integer, default=0)   # of those, how many it called right
    last_observed = Column(Date)
    last_confirmed = Column(Date)
    status = Column(String(15), default="hypothesis")    # hypothesis, emerging, established, invalidated
    supporting_observations = Column(JSONB, default=[])

    __table_args__ = (
        Index("idx_patterns_status", "status"),
        Index("idx_patterns_category", "category", "status"),
    )


class AIMarketRegime(Base):
    """Daily market regime snapshot — overall market state assessment."""

    __tablename__ = "ai_market_regime"

    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False, unique=True, index=True)
    trend = Column(String(15), nullable=False)           # bullish, bearish, sideways, transitioning
    trend_strength = Column(String(10))                  # weak, moderate, strong
    volatility_regime = Column(String(15))               # low, normal, elevated, extreme
    breadth_health = Column(String(15))                  # healthy, narrowing, weak, divergent
    leading_sectors = Column(JSONB, default=[])
    lagging_sectors = Column(JSONB, default=[])
    nepse_index = Column(Float)
    key_levels = Column(JSONB)                           # {"support": 2380, "resistance": 2500, "pivot": 2440}
    regime_duration_days = Column(Integer, default=1)
    notes = Column(Text)


class AIMemorySummary(Base):
    """Compressed weekly/monthly digests of AI memory."""

    __tablename__ = "ai_memory_summaries"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    period_type = Column(String(10), nullable=False)     # weekly, monthly
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    summary_text = Column(Text, nullable=False)
    key_events = Column(JSONB, default=[])
    prediction_scorecard = Column(JSONB)                 # {"total": 15, "confirmed": 9, "invalidated": 4, "expired": 2}
    market_regime_summary = Column(JSONB)
    sector_performance = Column(JSONB)
    notable_stocks = Column(JSONB, default=[])

    __table_args__ = (
        UniqueConstraint("period_type", "period_start", name="uq_summary_period"),
    )
