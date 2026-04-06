"""FastAPI application entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import engine, Base
from .models import (
    StockPrice, Floorsheet, MarketStatus, AIInsight, MarketSummary,
    DailyMarketBreadth, DailySectorIndex, DailyTopMover,
)
from .providers import NepseAPIProvider, DataProviderManager
from .scheduler import IngestionScheduler
from .database import SessionLocal

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)

# Global scheduler instance
scheduler: IngestionScheduler = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic."""
    global scheduler

    # Startup
    logger.info("Creating database tables...")
    Base.metadata.create_all(bind=engine)

    logger.info("Initializing data providers...")
    primary_provider = NepseAPIProvider(
        base_url=settings.nepse_api_url,
        timeout=settings.nepse_api_timeout,
    )
    provider_manager = DataProviderManager(primary=primary_provider, fallback=None)

    logger.info("Starting ingestion scheduler...")
    scheduler = IngestionScheduler(provider_manager, SessionLocal)
    scheduler.start()

    yield

    # Shutdown
    logger.info("Shutting down scheduler...")
    scheduler.stop()
    await primary_provider.close()


app = FastAPI(
    title="NEPSE AI Dashboard",
    description="Personal NEPSE market intelligence dashboard",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "scheduler_running": scheduler is not None}


@app.get("/api/admin/status")
async def admin_status():
    """DB row counts for monitoring backfill progress."""
    from sqlalchemy import func
    db = SessionLocal()
    try:
        stock_rows = db.query(func.count(StockPrice.id)).scalar()
        summary_rows = db.query(func.count(MarketSummary.id)).scalar()
        insight_rows = db.query(func.count(AIInsight.id)).scalar()
        return {
            "stock_prices": stock_rows,
            "market_summary": summary_rows,
            "ai_insights": insight_rows,
        }
    finally:
        db.close()


@app.get("/api/stocks/latest")
async def get_latest_prices():
    """Get latest price for each symbol (DISTINCT ON pattern)."""
    db = SessionLocal()
    try:
        # PostgreSQL DISTINCT ON: get latest price per symbol
        prices = db.query(StockPrice).from_statement(
            StockPrice.__table__.select().distinct(StockPrice.symbol).order_by(StockPrice.symbol, StockPrice.time.desc())
        ).all()
        return [
            {
                "symbol": p.symbol,
                "ltp": p.ltp,
                "change": p.change,
                "changePercent": p.change_percent,
                "time": p.time,
            }
            for p in prices
        ]
    finally:
        db.close()


@app.get("/api/index/history")
async def get_index_history(range: str = Query(default="1D", regex="^(1D|5D|1M|3M|6M|1Y|5Y)$")):
    """Get NEPSE index time-series for the given range.

    Primary source: MarketSummary table (real NEPSE index values).
    Fallback: daily average LTP from StockPrice table when summary is sparse (<2 rows).
    """
    from sqlalchemy import func, cast, Date as SADate, text

    range_map = {
        "1D": timedelta(days=1),
        "5D": timedelta(days=10),   # 10 calendar days covers 5 trading days across weekends/holidays
        "1M": timedelta(days=30),
        "3M": timedelta(days=90),
        "6M": timedelta(days=180),
        "1Y": timedelta(days=365),
        "5Y": timedelta(days=1825),
    }
    cutoff = datetime.now(timezone.utc) - range_map[range]
    db = SessionLocal()
    try:
        # Try real MarketSummary data first
        rows = db.query(MarketSummary).filter(
            MarketSummary.time >= cutoff
        ).order_by(MarketSummary.time.asc()).all()

        if len(rows) >= 2:
            return [
                {
                    "time": r.time.isoformat(),
                    "value": r.nepse_index,
                    "change": r.nepse_change,
                    "changePct": r.nepse_change_pct,
                }
                for r in rows
            ]

        # Fallback: derive a market proxy from daily average LTP across all backfilled stocks.
        # Groups stock_prices by calendar date and averages LTP for each day.
        # Not the real NEPSE index but shows real price movement from backfill data.
        result = db.execute(
            text("""
                SELECT
                    date_trunc('day', time AT TIME ZONE 'Asia/Kathmandu') AS day,
                    AVG(ltp) AS avg_ltp,
                    COUNT(DISTINCT symbol) AS scrips
                FROM stock_prices
                WHERE time >= :cutoff
                  AND source = 'backfill'
                GROUP BY day
                ORDER BY day ASC
            """),
            {"cutoff": cutoff}
        ).fetchall()

        if not result:
            # Return whatever MarketSummary rows we have (could be 0 or 1)
            return [
                {"time": r.time.isoformat(), "value": r.nepse_index, "change": r.nepse_change, "changePct": r.nepse_change_pct}
                for r in rows
            ]

        # Scale the avg LTP proxy to match the last known real NEPSE index value
        # so the chart doesn't show confusingly different numbers.
        last_known = rows[-1].nepse_index if rows else None
        last_proxy = float(result[-1][1])
        scale = (last_known / last_proxy) if last_known and last_proxy else 1.0

        points = []
        prev_value = None
        for row in result:
            day, avg_ltp, _ = row
            value = round(float(avg_ltp) * scale, 2)
            change = round(value - prev_value, 2) if prev_value is not None else 0.0
            change_pct = round((change / prev_value) * 100, 2) if prev_value else 0.0
            points.append({
                "time": day.isoformat(),
                "value": value,
                "change": change,
                "changePct": change_pct,
            })
            prev_value = value

        return points
    finally:
        db.close()


@app.get("/api/insights/latest")
async def get_latest_insight(type: str = None):
    """Get the most recent AI-generated market insight. Optional ?type= filter."""
    db = SessionLocal()
    try:
        q = db.query(AIInsight).order_by(AIInsight.generated_at.desc())
        if type:
            q = q.filter(AIInsight.insight_type == type)
        insight = q.first()
        if not insight:
            return None
        return {
            "insight_text": insight.insight_text,
            "insight_type": insight.insight_type,
            "generated_at": insight.generated_at.isoformat(),
            "extra_data": insight.extra_data,
        }
    finally:
        db.close()


@app.get("/api/insights/history")
async def get_insight_history(limit: int = 10):
    """Get recent AI insights in reverse chronological order."""
    db = SessionLocal()
    try:
        insights = (
            db.query(AIInsight)
            .order_by(AIInsight.generated_at.desc())
            .limit(min(limit, 50))
            .all()
        )
        return [
            {
                "insight_text": i.insight_text,
                "insight_type": i.insight_type,
                "generated_at": i.generated_at.isoformat(),
                "extra_data": i.extra_data,
            }
            for i in insights
        ]
    finally:
        db.close()


@app.post("/api/admin/run/backfill")
async def admin_run_backfill(days: int = 365, symbols: str = None):
    """Manually trigger historical data backfill. Runs in background."""
    from .backfill import main as backfill_main
    symbol_list = [s.strip().upper() for s in symbols.split(",")] if symbols else None
    asyncio.create_task(backfill_main(days=days, symbols=symbol_list))
    return {"ok": True, "action": "backfill", "days": days, "symbols": symbol_list or "all"}


@app.post("/api/admin/run/ingest-prices")
async def admin_run_ingest_prices():
    """Manually trigger live price ingestion."""
    if scheduler is None:
        return {"ok": False, "error": "Scheduler not running"}
    try:
        await scheduler.ingest_live_prices()
        return {"ok": True, "action": "ingest_live_prices"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/run/ingest-summary")
async def admin_run_ingest_summary():
    """Manually trigger NEPSE index + market summary ingestion."""
    if scheduler is None:
        return {"ok": False, "error": "Scheduler not running"}
    try:
        await scheduler.ingest_market_summary()
        return {"ok": True, "action": "ingest_market_summary"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/run/ingest-snapshot")
async def admin_run_ingest_snapshot():
    """Manually trigger market snapshot (sectors/breadth/movers). Bypasses market-open check."""
    if scheduler is None:
        return {"ok": False, "error": "Scheduler not running"}
    try:
        await scheduler.ingest_market_snapshot(force=True)
        return {"ok": True, "action": "ingest_market_snapshot"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/run/generate-insight")
async def admin_run_generate_insight(type: str = "daily_close"):
    """Manually trigger AI insight generation. type: market_open, hourly, daily_close, weekly_wrap"""
    if scheduler is None:
        return {"ok": False, "error": "Scheduler not running"}
    try:
        if type == "market_open":
            await scheduler.generate_ai_open_briefing()
        elif type == "hourly":
            await scheduler.generate_ai_hourly()
        elif type == "weekly_wrap":
            await scheduler.generate_ai_weekly()
        else:
            await scheduler.generate_ai_insight()
        return {"ok": True, "action": "generate_ai_insight", "type": type}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/stocks/{symbol}/floorsheet")
async def get_symbol_floorsheet(symbol: str, limit: int = 100):
    """Get recent floorsheet for symbol."""
    db = SessionLocal()
    try:
        floorsheet = db.query(Floorsheet).filter(
            Floorsheet.symbol == symbol
        ).order_by(Floorsheet.time.desc()).limit(limit).all()
        return [
            {
                "symbol": f.symbol,
                "buyer": f.buyer,
                "seller": f.seller,
                "quantity": f.quantity,
                "rate": f.rate,
                "time": f.time,
            }
            for f in floorsheet
        ]
    finally:
        db.close()


@app.get("/api/market/overview")
async def get_market_overview():
    """Market status + 4 NEPSE indices + summary stats. Cache → DB fallback."""
    from .cache import get_cache, make_envelope

    cache = get_cache()
    cached = cache.get("market_overview")
    if cached:
        return cached

    # DB fallback: latest market summary row
    db = SessionLocal()
    try:
        row = db.query(MarketSummary).order_by(MarketSummary.time.desc()).first()
        if row:
            data = {
                "isOpen": False,
                "indices": [
                    {"name": "NEPSE", "value": row.nepse_index, "change": row.nepse_change, "changePct": row.nepse_change_pct},
                ],
                "summary": {
                    "totalTurnover": row.total_turnover,
                    "totalShares": row.total_shares,
                    "totalTransactions": row.total_transactions,
                },
                "lastUpdated": row.time.isoformat(),
            }
            return make_envelope(data, "db")
        return make_envelope(None, "db")
    finally:
        db.close()


def _latest_date(db, model, date_col):
    """Return the most recent date with data in a daily table."""
    from sqlalchemy import func
    result = db.query(func.max(date_col)).scalar()
    return result


_RANGE_DAYS = {
    "1D": 10,    # 10 calendar days covers 1 trading week + weekends
    "5D": 10,
    "1M": 30,
    "3M": 90,
    "6M": 180,
    "1Y": 365,
    "5Y": 1825,
}

# Hardcoded NEPSE symbol → sector mapping (used as fallback when DailySectorIndex is empty)
_NEPSE_SECTORS: dict[str, str] = {
    # Commercial Banks
    "NABIL": "Banks", "HBL": "Banks", "EBL": "Banks", "KBL": "Banks",
    "NICA": "Banks", "NMB": "Banks", "NIMB": "Banks", "SBI": "Banks",
    "SCB": "Banks", "MBL": "Banks", "PRVU": "Banks", "SANIMA": "Banks",
    "RBCL": "Banks", "SBL": "Banks", "NLO": "Banks", "BNL": "Banks",
    # Development Banks
    "EDBL": "Dev. Banks", "SWBBL": "Dev. Banks", "DDBL": "Dev. Banks",
    "NUBL": "Dev. Banks", "CBBL": "Dev. Banks", "SFCL": "Dev. Banks",
    # Finance Companies
    "BFC": "Finance", "CFCL": "Finance", "GFCL": "Finance", "ICFC": "Finance",
    "PFL": "Finance", "SIFC": "Finance", "JFL": "Finance", "GUFL": "Finance",
    # Microfinance
    "GMFIL": "Microfinance", "NABBC": "Microfinance", "PROFL": "Microfinance",
    "SPIL": "Microfinance", "NFS": "Microfinance",
    # Insurance
    "LICN": "Insurance", "NLIC": "Insurance", "IGI": "Insurance",
    "NICL": "Insurance", "SICL": "Insurance", "SALICO": "Insurance",
    "PRIN": "Insurance", "UAIL": "Insurance", "NLICL": "Insurance",
    "NIL": "Insurance", "LSL": "Insurance",
    # Hotels & Tourism
    "OHL": "Hotels", "SHL": "Hotels", "TRH": "Hotels",
    # Hydropower
    "NHPC": "Hydropower", "CHCL": "Hydropower", "HEI": "Hydropower",
    "HDL": "Hydropower", "BBC": "Hydropower",
    # Manufacturing & Processing
    "BNT": "Manufacturing", "UNL": "Manufacturing", "BPCL": "Manufacturing",
    # Others
    "NTC": "Others", "CIT": "Others", "STC": "Others",
}


def _range_cutoff(range_str: str) -> datetime:
    days = _RANGE_DAYS.get(range_str, 10)
    return datetime.now(timezone.utc) - timedelta(days=days)


def _compute_movers_from_backfill(db, cutoff: datetime, order_desc: bool = True, limit: int = 10):
    """Derive top movers from stock_prices backfill data when daily tables are empty."""
    from sqlalchemy import text
    order = "DESC" if order_desc else "ASC"
    rows = db.execute(text(f"""
        WITH bounds AS (
            SELECT symbol, MIN(time) AS t_first, MAX(time) AS t_last
            FROM stock_prices
            WHERE time >= :cutoff AND source = 'backfill'
            GROUP BY symbol
            HAVING MIN(time) < MAX(time)
        ),
        changes AS (
            SELECT b.symbol,
                   sp_l.ltp AS ltp,
                   sp_l.ltp - sp_f.ltp AS change,
                   CASE WHEN sp_f.ltp > 0
                        THEN (sp_l.ltp - sp_f.ltp) / sp_f.ltp * 100
                        ELSE 0 END AS change_pct
            FROM bounds b
            JOIN stock_prices sp_f ON sp_f.symbol = b.symbol
                AND sp_f.time = b.t_first AND sp_f.source = 'backfill'
            JOIN stock_prices sp_l ON sp_l.symbol = b.symbol
                AND sp_l.time = b.t_last  AND sp_l.source = 'backfill'
        )
        SELECT symbol, ltp, change, change_pct,
               ROW_NUMBER() OVER (ORDER BY change_pct {order}) AS rank
        FROM changes
        ORDER BY change_pct {order}
        LIMIT :limit
    """), {"cutoff": cutoff, "limit": limit}).fetchall()
    return [
        {"rank": r.rank, "symbol": r.symbol, "ltp": r.ltp,
         "change": r.change, "changePct": r.change_pct}
        for r in rows
    ]


def _compute_breadth_from_backfill(db, cutoff: datetime):
    """Derive advance/decline/unchanged counts from stock_prices backfill data."""
    from sqlalchemy import text
    row = db.execute(text("""
        WITH bounds AS (
            SELECT symbol, MIN(time) AS t_first, MAX(time) AS t_last
            FROM stock_prices
            WHERE time >= :cutoff AND source = 'backfill'
            GROUP BY symbol
            HAVING MIN(time) < MAX(time)
        ),
        changes AS (
            SELECT b.symbol, sp_l.ltp - sp_f.ltp AS chg
            FROM bounds b
            JOIN stock_prices sp_f ON sp_f.symbol = b.symbol
                AND sp_f.time = b.t_first AND sp_f.source = 'backfill'
            JOIN stock_prices sp_l ON sp_l.symbol = b.symbol
                AND sp_l.time = b.t_last  AND sp_l.source = 'backfill'
        )
        SELECT
            COUNT(*) FILTER (WHERE chg > 0)  AS advances,
            COUNT(*) FILTER (WHERE chg < 0)  AS declines,
            COUNT(*) FILTER (WHERE chg = 0)  AS unchanged,
            COUNT(*)                          AS total
        FROM changes
    """), {"cutoff": cutoff}).fetchone()
    if not row or row.total == 0:
        return None
    ad_ratio = row.advances / row.declines if row.declines > 0 else float(row.advances)
    return {
        "advances": row.advances, "declines": row.declines,
        "unchanged": row.unchanged, "total": row.total,
        "adRatio": round(ad_ratio, 2),
    }


def _compute_turnover_from_backfill(db, cutoff: datetime, limit: int = 10):
    """Derive top turnover leaders from stock_prices backfill data."""
    from sqlalchemy import text
    rows = db.execute(text("""
        SELECT symbol,
               SUM(turnover) AS total_turnover,
               MAX(ltp)      AS ltp,
               ROW_NUMBER() OVER (ORDER BY SUM(turnover) DESC) AS rank
        FROM stock_prices
        WHERE time >= :cutoff AND source = 'backfill' AND turnover IS NOT NULL
        GROUP BY symbol
        ORDER BY total_turnover DESC
        LIMIT :limit
    """), {"cutoff": cutoff, "limit": limit}).fetchall()
    return [
        {"rank": r.rank, "symbol": r.symbol, "ltp": r.ltp, "turnover": r.total_turnover}
        for r in rows
    ]


def _compute_sectors_from_backfill(db, cutoff: datetime):
    """Derive sector performance from stock_prices backfill using hardcoded sector map."""
    from sqlalchemy import text
    rows = db.execute(text("""
        WITH bounds AS (
            SELECT symbol, MIN(time) AS t_first, MAX(time) AS t_last
            FROM stock_prices
            WHERE time >= :cutoff AND source = 'backfill'
            GROUP BY symbol
            HAVING MIN(time) < MAX(time)
        ),
        changes AS (
            SELECT b.symbol,
                   sp_l.ltp AS end_ltp,
                   CASE WHEN sp_f.ltp > 0
                        THEN (sp_l.ltp - sp_f.ltp) / sp_f.ltp * 100
                        ELSE 0 END AS change_pct
            FROM bounds b
            JOIN stock_prices sp_f ON sp_f.symbol = b.symbol
                AND sp_f.time = b.t_first AND sp_f.source = 'backfill'
            JOIN stock_prices sp_l ON sp_l.symbol = b.symbol
                AND sp_l.time = b.t_last  AND sp_l.source = 'backfill'
        )
        SELECT symbol, end_ltp, change_pct FROM changes
    """), {"cutoff": cutoff}).fetchall()

    from collections import defaultdict
    sector_totals: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        sector = _NEPSE_SECTORS.get(r.symbol, "Others")
        sector_totals[sector].append(r.change_pct)

    result = []
    for sector, changes in sector_totals.items():
        avg_chg = sum(changes) / len(changes)
        result.append({
            "name": sector,
            "value": None,
            "change": None,
            "changePct": round(avg_chg, 2),
        })
    return sorted(result, key=lambda x: x["changePct"], reverse=True)


@app.get("/api/market/sectors")
async def get_market_sectors(range: str = Query(default="1D", regex="^(1D|5D|1M|3M|6M|1Y|5Y)$")):
    """Sector sub-indices. Cache → DB fallback (most recent trading day)."""
    from .cache import get_cache, make_envelope
    from sqlalchemy import func

    cache = get_cache()
    if range == "1D":
        cached = cache.get("sectors")
        if cached:
            return cached

    db = SessionLocal()
    try:
        cutoff = _range_cutoff(range)
        latest = _latest_date(db, DailySectorIndex, DailySectorIndex.date)
        if latest:
            if range == "1D":
                rows = db.query(DailySectorIndex).filter(
                    DailySectorIndex.date == latest
                ).order_by(DailySectorIndex.change_pct.desc()).all()
                data = [
                    {"name": r.sector_name, "value": r.index_value, "change": r.change, "changePct": r.change_pct}
                    for r in rows
                ]
            else:
                from sqlalchemy import text
                rows_agg = db.execute(text("""
                    WITH earliest AS (
                        SELECT DISTINCT ON (sector_name) sector_name, index_value AS start_value
                        FROM daily_sector_indices WHERE date >= :cutoff
                        ORDER BY sector_name, date ASC
                    ),
                    latest_v AS (
                        SELECT DISTINCT ON (sector_name) sector_name, index_value AS end_value
                        FROM daily_sector_indices WHERE date >= :cutoff
                        ORDER BY sector_name, date DESC
                    )
                    SELECT e.sector_name AS name, lv.end_value AS value,
                           lv.end_value - e.start_value AS change,
                           CASE WHEN e.start_value > 0
                                THEN (lv.end_value - e.start_value) / e.start_value * 100
                                ELSE 0 END AS change_pct
                    FROM earliest e JOIN latest_v lv ON e.sector_name = lv.sector_name
                    ORDER BY change_pct DESC
                """), {"cutoff": cutoff.date()}).fetchall()
                data = [
                    {"name": r.name, "value": r.value, "change": r.change, "changePct": r.change_pct}
                    for r in rows_agg
                ] if rows_agg else []
            return make_envelope(data, "db")
        # Backfill fallback: derive sector performance from stock_prices + hardcoded mapping
        data = _compute_sectors_from_backfill(db, cutoff)
        return make_envelope(data, "backfill")
    finally:
        db.close()


@app.get("/api/market/top-gainers")
async def get_top_gainers(range: str = Query(default="1D", regex="^(1D|5D|1M|3M|6M|1Y|5Y)$")):
    """Top gaining stocks. Cache → DB → backfill fallback."""
    from .cache import get_cache, make_envelope

    cache = get_cache()
    if range == "1D":
        cached = cache.get("top_gainers")
        if cached:
            return cached

    db = SessionLocal()
    try:
        cutoff = _range_cutoff(range)
        latest = _latest_date(db, DailyTopMover, DailyTopMover.date)
        if latest:
            if range == "1D":
                rows = db.query(DailyTopMover).filter(
                    DailyTopMover.date == latest,
                    DailyTopMover.category == "gainer",
                ).order_by(DailyTopMover.rank).all()
                data = [
                    {"rank": r.rank, "symbol": r.symbol, "ltp": r.ltp, "change": r.change, "changePct": r.change_pct}
                    for r in rows
                ]
            else:
                data = _compute_movers_from_backfill(db, cutoff, order_desc=True)
            return make_envelope(data, "db")
        # Backfill fallback
        data = _compute_movers_from_backfill(db, cutoff, order_desc=True)
        return make_envelope(data, "backfill")
    finally:
        db.close()


@app.get("/api/market/top-losers")
async def get_top_losers(range: str = Query(default="1D", regex="^(1D|5D|1M|3M|6M|1Y|5Y)$")):
    """Top losing stocks. Cache → DB → backfill fallback."""
    from .cache import get_cache, make_envelope

    cache = get_cache()
    if range == "1D":
        cached = cache.get("top_losers")
        if cached:
            return cached

    db = SessionLocal()
    try:
        cutoff = _range_cutoff(range)
        latest = _latest_date(db, DailyTopMover, DailyTopMover.date)
        if latest:
            if range == "1D":
                rows = db.query(DailyTopMover).filter(
                    DailyTopMover.date == latest,
                    DailyTopMover.category == "loser",
                ).order_by(DailyTopMover.rank).all()
                data = [
                    {"rank": r.rank, "symbol": r.symbol, "ltp": r.ltp, "change": r.change, "changePct": r.change_pct}
                    for r in rows
                ]
            else:
                data = _compute_movers_from_backfill(db, cutoff, order_desc=False)
            return make_envelope(data, "db")
        # Backfill fallback
        data = _compute_movers_from_backfill(db, cutoff, order_desc=False)
        return make_envelope(data, "backfill")
    finally:
        db.close()


@app.get("/api/market/top-turnover")
async def get_top_turnover(range: str = Query(default="1D", regex="^(1D|5D|1M|3M|6M|1Y|5Y)$")):
    """Top turnover scrips. Cache → DB fallback (most recent trading day)."""
    from .cache import get_cache, make_envelope
    from sqlalchemy import text

    cache = get_cache()
    if range == "1D":
        cached = cache.get("top_turnover")
        if cached:
            return cached

    db = SessionLocal()
    try:
        cutoff = _range_cutoff(range)
        latest = _latest_date(db, DailyTopMover, DailyTopMover.date)
        if latest:
            if range == "1D":
                rows = db.query(DailyTopMover).filter(
                    DailyTopMover.date == latest,
                    DailyTopMover.category == "turnover",
                ).order_by(DailyTopMover.rank).all()
                data = [
                    {"rank": r.rank, "symbol": r.symbol, "ltp": r.ltp, "turnover": r.turnover}
                    for r in rows
                ]
            else:
                rows_agg = db.execute(text("""
                    SELECT symbol, SUM(turnover) AS total_turnover,
                           MAX(ltp) AS ltp,
                           ROW_NUMBER() OVER (ORDER BY SUM(turnover) DESC) AS rank
                    FROM daily_top_movers
                    WHERE category = 'turnover' AND date >= :cutoff
                    GROUP BY symbol
                    ORDER BY total_turnover DESC
                    LIMIT 10
                """), {"cutoff": cutoff.date()}).fetchall()
                data = [
                    {"rank": r.rank, "symbol": r.symbol, "ltp": r.ltp, "turnover": r.total_turnover}
                    for r in rows_agg
                ] if rows_agg else []
            return make_envelope(data, "db")
        # Backfill fallback
        data = _compute_turnover_from_backfill(db, cutoff)
        return make_envelope(data, "backfill")
    finally:
        db.close()


@app.get("/api/market/breadth")
async def get_market_breadth(range: str = Query(default="1D", regex="^(1D|5D|1M|3M|6M|1Y|5Y)$")):
    """Market breadth (advance/decline/unchanged). Cache → DB → backfill fallback."""
    from .cache import get_cache, make_envelope
    from sqlalchemy import text

    cache = get_cache()
    if range == "1D":
        cached = cache.get("breadth")
        if cached:
            return cached

    db = SessionLocal()
    try:
        cutoff = _range_cutoff(range)
        latest = _latest_date(db, DailyMarketBreadth, DailyMarketBreadth.date)
        if latest:
            if range == "1D":
                row = db.query(DailyMarketBreadth).filter(
                    DailyMarketBreadth.date == latest
                ).first()
                if row:
                    return make_envelope({
                        "advances": row.advances, "declines": row.declines,
                        "unchanged": row.unchanged, "total": row.total,
                        "adRatio": row.ad_ratio,
                    }, "db")
            else:
                # Aggregate across range
                agg = db.execute(text("""
                    SELECT SUM(advances) AS advances, SUM(declines) AS declines,
                           SUM(unchanged) AS unchanged, SUM(total) AS total
                    FROM daily_market_breadth WHERE date >= :cutoff
                """), {"cutoff": cutoff.date()}).fetchone()
                if agg and agg.total:
                    ad_ratio = agg.advances / agg.declines if agg.declines > 0 else float(agg.advances)
                    return make_envelope({
                        "advances": agg.advances, "declines": agg.declines,
                        "unchanged": agg.unchanged, "total": agg.total,
                        "adRatio": round(ad_ratio, 2),
                    }, "db")
        # Backfill fallback
        data = _compute_breadth_from_backfill(db, cutoff)
        return make_envelope(data, "backfill")
    finally:
        db.close()


@app.get("/api/market/companies")
async def get_company_list():
    """Active equity company list for autocomplete. Cached 1hr."""
    from .cache import get_cache, make_envelope

    cache = get_cache()
    cached = cache.get("company_list")
    if cached:
        return cached

    # Fetch from NepseAPI and cache for 1 hour
    provider = NepseAPIProvider(base_url=settings.nepse_api_url)
    try:
        companies = await provider.get_company_list()
        active = [
            {"symbol": c.get("symbol", ""), "name": c.get("companyName", "") or c.get("name", "")}
            for c in companies
            if c.get("status") == "A" and c.get("instrumentType") in ("Equity", "equity", None)
        ]
        envelope = make_envelope(active, "live")
        cache.set("company_list", envelope, ttl=3600)
        return envelope
    except Exception as e:
        logger.error(f"Failed to fetch company list: {e}")
        return make_envelope([], "db")
    finally:
        await provider.close()


@app.get("/api/stocks/{symbol}/history")
async def get_stock_history(symbol: str):
    """Per-symbol OHLCV history. Cache 5min per symbol → DB fallback."""
    from .cache import get_cache, make_envelope

    cache_key = f"stock_history:{symbol.upper()}"
    cache = get_cache()
    cached = cache.get(cache_key)
    if cached:
        return cached

    # DB fallback: use backfilled data
    db = SessionLocal()
    try:
        rows = db.query(StockPrice).filter(
            StockPrice.symbol == symbol.upper(),
            StockPrice.source == "backfill",
        ).order_by(StockPrice.time.asc()).all()

        if rows:
            data = [
                {
                    "date": r.time.date().isoformat(),
                    "open": r.open,
                    "high": r.high,
                    "low": r.low,
                    "close": r.ltp,
                    "volume": r.volume,
                    "turnover": r.turnover,
                }
                for r in rows
            ]
            envelope = make_envelope(data, "db")
            cache.set(cache_key, envelope, ttl=300)
            return envelope

        # Try live from NepseAPI
        provider = NepseAPIProvider(base_url=settings.nepse_api_url)
        try:
            response = await provider.client.get(
                f"{settings.nepse_api_url}/PriceVolumeHistory",
                params={"symbol": symbol.upper()},
            )
            response.raise_for_status()
            history = response.json()
            data = [
                {
                    "date": h.get("businessDate", ""),
                    "open": h.get("openPrice"),
                    "high": h.get("highPrice"),
                    "low": h.get("lowPrice"),
                    "close": h.get("closePrice") or h.get("lastTradedPrice"),
                    "volume": h.get("totalTradedQuantity"),
                    "turnover": h.get("totalTradedValue"),
                }
                for h in (history if isinstance(history, list) else [])
            ]
            envelope = make_envelope(data, "live")
            cache.set(cache_key, envelope, ttl=300)
            return envelope
        except Exception:
            return make_envelope([], "db")
        finally:
            await provider.close()
    finally:
        db.close()


@app.get("/api/stocks/{symbol}/analysis")
async def get_stock_analysis(symbol: str):
    """Full stock analysis: price, returns, technicals, volume, volatility, signals, floorsheet."""
    from .cache import get_cache, make_envelope
    from .indicators import (
        sma, sma_series, ema, rsi as calc_rsi, macd as calc_macd,
        bollinger, bollinger_series, atr as calc_atr,
        period_return, historical_volatility, derive_signals,
    )
    from sqlalchemy import text

    sym = symbol.upper()
    cache_key = f"stock_analysis:{sym}"
    cache = get_cache()
    cached = cache.get(cache_key)
    if cached:
        return cached

    db = SessionLocal()
    try:
        # --- Fetch all price rows for symbol (backfill + live) ---
        rows = db.query(StockPrice).filter(
            StockPrice.symbol == sym,
        ).order_by(StockPrice.time.asc()).all()

        if not rows:
            return make_envelope(None, "db")

        # Build arrays
        closes  = [r.ltp for r in rows]
        highs   = [r.high  if r.high  is not None else r.ltp for r in rows]
        lows    = [r.low   if r.low   is not None else r.ltp for r in rows]
        volumes = [r.volume   or 0 for r in rows]
        turnovers = [r.turnover or 0 for r in rows]
        dates   = [r.time.date().isoformat() for r in rows]

        ltp = closes[-1]
        prev_close = closes[-2] if len(closes) >= 2 else None

        # Use DB change fields if available (live data), else compute from closes
        last_row = rows[-1]
        change_val = last_row.change if last_row.change is not None else (
            round(ltp - prev_close, 2) if prev_close else None
        )
        change_pct = last_row.change_percent if last_row.change_percent is not None else (
            round(((ltp - prev_close) / prev_close) * 100, 2) if prev_close else None
        )

        # --- 52W metrics ---
        now = datetime.now(timezone.utc)
        cutoff_1y = now - timedelta(days=365)
        rows_1y = [r for r in rows if r.time >= cutoff_1y]
        closes_1y = [r.ltp for r in rows_1y]
        highs_1y  = [r.high or r.ltp for r in rows_1y]
        lows_1y   = [r.low  or r.ltp for r in rows_1y]

        high52w = max(highs_1y) if highs_1y else max(highs)
        low52w  = min(lows_1y)  if lows_1y  else min(lows)
        all_time_high = max(highs)
        range_pos = round((ltp - low52w) / (high52w - low52w), 3) if high52w != low52w else 0.5

        # --- Period returns (trading days in lists) ---
        # Map approximate calendar days → list index lookback
        lookbacks = {"1d": 1, "5d": 5, "1m": 22, "3m": 66, "6m": 132, "1y": 220}
        returns = {k: period_return(closes, v) for k, v in lookbacks.items()}

        # --- Technical indicators ---
        sma20  = sma(closes, 20)
        sma50  = sma(closes, 50)
        sma200 = sma(closes, 200)
        ema12  = ema(closes, 12)
        ema26  = ema(closes, 26)
        rsi14  = calc_rsi(closes, 14)
        macd_d = calc_macd(closes)
        bb     = bollinger(closes, 20)
        atr14  = calc_atr(highs, lows, closes, 14)

        # Chart overlay series
        sma20_series  = sma_series(closes, dates, 20)
        sma50_series  = sma_series(closes, dates, 50)
        sma200_series = sma_series(closes, dates, 200)
        bb_series     = bollinger_series(closes, dates, 20)

        # --- Volume analytics ---
        vol_latest = volumes[-1] if volumes else None
        avg20d_vol  = round(sum(volumes[-20:]) / min(len(volumes), 20), 0) if volumes else None
        avg90d_vol  = round(sum(volumes[-90:]) / min(len(volumes), 90), 0) if volumes else None
        vol_ratio   = round(vol_latest / avg20d_vol, 2) if avg20d_vol and avg20d_vol > 0 else None
        avg_turnover20d = round(sum(turnovers[-20:]) / min(len(turnovers), 20), 0) if turnovers else None

        # --- Volatility ---
        vol_stats = historical_volatility(closes, 30)
        ranges20d = [(highs[i] - lows[i]) for i in range(-min(20, len(closes)), 0)]
        avg_range20d = round(sum(ranges20d) / len(ranges20d), 2) if ranges20d else None

        # --- Relative performance vs NEPSE ---
        cutoff_30d = now - timedelta(days=45)
        nepse_rows = db.query(MarketSummary).filter(
            MarketSummary.time >= cutoff_30d
        ).order_by(MarketSummary.time.asc()).all()

        rel_perf = None
        if nepse_rows and len(nepse_rows) >= 2:
            nepse_old = nepse_rows[0].nepse_index
            nepse_new = nepse_rows[-1].nepse_index
            if nepse_old and nepse_old > 0:
                nepse_ret30 = round(((nepse_new - nepse_old) / nepse_old) * 100, 2)
                stock_ret30 = period_return(closes, 30) or period_return(closes, len(closes) - 1)
                alpha = round(stock_ret30 - nepse_ret30, 2) if stock_ret30 is not None else None
                rel_perf = {
                    "stockReturn30d": stock_ret30,
                    "nepseReturn30d": nepse_ret30,
                    "alpha30d": alpha,
                }

        # --- Floorsheet insights ---
        cutoff_fs = datetime.now(timezone.utc) - timedelta(days=30)
        fs_stats = db.execute(text("""
            SELECT
                SUM(quantity * rate) / NULLIF(SUM(quantity), 0) AS vwap,
                AVG(quantity)  AS avg_trade_size,
                COUNT(*)       AS total_trades
            FROM floorsheet
            WHERE symbol = :sym AND time >= :cutoff
        """), {"sym": sym, "cutoff": cutoff_fs}).fetchone()

        top_buyers = db.execute(text("""
            SELECT buyer AS broker, SUM(quantity) AS total_qty, COUNT(*) AS trades
            FROM floorsheet
            WHERE symbol = :sym AND time >= :cutoff
            GROUP BY buyer ORDER BY total_qty DESC LIMIT 5
        """), {"sym": sym, "cutoff": cutoff_fs}).fetchall()

        top_sellers = db.execute(text("""
            SELECT seller AS broker, SUM(quantity) AS total_qty, COUNT(*) AS trades
            FROM floorsheet
            WHERE symbol = :sym AND time >= :cutoff
            GROUP BY seller ORDER BY total_qty DESC LIMIT 5
        """), {"sym": sym, "cutoff": cutoff_fs}).fetchall()

        floorsheet_data = None
        if fs_stats and fs_stats.total_trades and fs_stats.total_trades > 0:
            floorsheet_data = {
                "topBuyers": [
                    {"broker": r.broker, "quantity": int(r.total_qty), "trades": int(r.trades)}
                    for r in top_buyers
                ],
                "topSellers": [
                    {"broker": r.broker, "quantity": int(r.total_qty), "trades": int(r.trades)}
                    for r in top_sellers
                ],
                "avgTradeSize": round(fs_stats.avg_trade_size, 0) if fs_stats.avg_trade_size else None,
                "vwap": round(fs_stats.vwap, 2) if fs_stats.vwap else None,
                "totalTrades": int(fs_stats.total_trades),
            }

        # --- Company name + sector ---
        sector = _NEPSE_SECTORS.get(sym)
        company_name = None
        cached_companies = cache.get("company_list")
        if cached_companies and isinstance(cached_companies, dict):
            for c in (cached_companies.get("data") or []):
                if c.get("symbol") == sym:
                    company_name = c.get("name")
                    break

        # --- Signals ---
        signals = derive_signals(ltp, sma20, sma50, sma200, rsi14, vol_ratio)

        # --- Full OHLCV history for chart ---
        history = [
            {
                "date": r.time.date().isoformat(),
                "open": r.open,
                "high": r.high,
                "low": r.low,
                "close": r.ltp,
                "volume": r.volume,
                "turnover": r.turnover,
            }
            for r in rows
        ]

        data = {
            "symbol": sym,
            "name": company_name,
            "sector": sector,
            "price": {
                "ltp": ltp,
                "change": change_val,
                "changePct": change_pct,
                "high52w": high52w,
                "low52w": low52w,
                "allTimeHigh": all_time_high,
                "rangePosition": range_pos,
                "prevClose": prev_close,
            },
            "returns": returns,
            "technicals": {
                "sma20": sma20,
                "sma50": sma50,
                "sma200": sma200,
                "ema12": ema12,
                "ema26": ema26,
                "rsi14": rsi14,
                "macd": macd_d,
                "bollingerBands": bb,
                "atr14": atr14,
            },
            "volume": {
                "latest": vol_latest,
                "avg20d": avg20d_vol,
                "avg90d": avg90d_vol,
                "volumeRatio": vol_ratio,
                "avgTurnover20d": avg_turnover20d,
            },
            "volatility": {
                "daily30d": vol_stats["daily30d"] if vol_stats else None,
                "annualized30d": vol_stats["annualized30d"] if vol_stats else None,
                "avgDailyRange20d": avg_range20d,
            },
            "relativePerformance": rel_perf,
            "floorsheet": floorsheet_data,
            "history": history,
            "overlays": {
                "sma20":          sma20_series,
                "sma50":          sma50_series,
                "sma200":         sma200_series,
                "bollingerUpper": [{"date": d["date"], "value": d["upper"]} for d in bb_series],
                "bollingerLower": [{"date": d["date"], "value": d["lower"]} for d in bb_series],
            },
            "signals": signals,
        }

        envelope = make_envelope(data, "db")
        cache.set(cache_key, envelope, ttl=300)
        return envelope

    finally:
        db.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
