"""Database models for NEPSE market data."""

from datetime import datetime
from sqlalchemy import Column, Integer, Float, String, Text, DateTime, Date, UniqueConstraint, Index
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
    )


class Floorsheet(Base):
    """Transaction-level floorsheet data (all trades)."""

    __tablename__ = "floorsheet"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(20), nullable=False, index=True)
    buyer = Column(String(100))
    seller = Column(String(100))
    quantity = Column(Integer, nullable=False)
    rate = Column(Float, nullable=False)
    contract_no = Column(Integer)
    time = Column(DateTime(timezone=True), nullable=False, index=True)

    __table_args__ = (
        Index("idx_floorsheet_symbol_time", "symbol", "time"),
        Index("idx_floorsheet_time", "time"),
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
