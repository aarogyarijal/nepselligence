"""Database models for NEPSE market data."""

from datetime import datetime
from sqlalchemy import Column, Integer, Float, String, DateTime, UniqueConstraint, Index
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


class AIInsight(Base):
    """AI-generated market insights from Claude API."""

    __tablename__ = "ai_insights"

    id = Column(Integer, primary_key=True)
    generated_at = Column(DateTime(timezone=True), nullable=False, index=True)
    insight_text = Column(String(2000), nullable=False)
    symbol = Column(String(20))  # Null if market-wide insight
    extra_data = Column(JSONB)  # Any extra structured data
