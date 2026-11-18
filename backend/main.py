"""FastAPI application entry point."""

import asyncio
import os
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
import zoneinfo

NPT = zoneinfo.ZoneInfo("Asia/Kathmandu")
from typing import Optional

from fastapi import FastAPI, Query, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import engine, Base
from .models import (
    StockPrice, Floorsheet, MarketStatus, AIInsight, MarketSummary,
    DailyMarketBreadth, DailySectorIndex, DailyTopMover, IntradaySectorValue,
    NewsArticle,
)
from .providers import NepseAPIProvider, DataProviderManager
from .scheduler import IngestionScheduler
from .database import SessionLocal

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)


def _to_npt_iso(dt: datetime) -> str:
    """Convert a datetime to NPT ISO string."""
    return dt.astimezone(NPT).isoformat()

# Global scheduler instance
scheduler: IngestionScheduler = None

# Interval constants
INTERVAL_MINUTES = {
    "1min": 1, "5min": 5, "15min": 15, "30min": 30,
    "1H": 60, "4H": 240, "1D": 1440,
}
DEFAULT_INTERVAL = {
    "today": "1min", "last_day": "1min", "5D": "15min", "1M": "1H",
    "3M": "1D", "6M": "1D", "1Y": "1D",
}


def _aggregate_timeseries(rows_iter, interval_minutes: int) -> list:
    """Bucket [{time (datetime), value (float)}] into N-minute intervals.
    Keeps last value per bucket. Computes change/changePct relative to first point."""
    from collections import OrderedDict
    buckets: dict[int, tuple] = OrderedDict()
    for t, val in rows_iter:
        if val is None:
            continue
        epoch = int(t.timestamp())
        bucket = (epoch // (interval_minutes * 60)) * (interval_minutes * 60)
        buckets[bucket] = (t, float(val))

    if not buckets:
        return []
    sorted_b = sorted(buckets.items())
    first_val = sorted_b[0][1][1]
    result = []
    for epoch, (_, val) in sorted_b:
        change = round(val - first_val, 2)
        change_pct = round((change / first_val) * 100, 2) if first_val else 0.0
        result.append({
            "time": datetime.fromtimestamp(epoch, tz=NPT).isoformat(),
            "value": val,
            "change": change,
            "changePct": change_pct,
        })
    return result


def _aggregate_ohlcv(rows_iter, interval_minutes: int) -> list:
    """Aggregate [{time (datetime), ltp (float), volume (int|None)}] to N-min OHLCV candles."""
    from collections import defaultdict
    buckets: dict[int, list] = defaultdict(list)
    for t, ltp, vol in rows_iter:
        if not ltp or ltp <= 0:
            continue
        epoch = int(t.timestamp())
        bucket = (epoch // (interval_minutes * 60)) * (interval_minutes * 60)
        buckets[bucket].append((t, float(ltp), vol or 0))
    result = []
    for bucket_epoch in sorted(buckets.keys()):
        ticks = buckets[bucket_epoch]
        vals = [v for _, v, _ in ticks]
        vols = [vol for _, _, vol in ticks]
        result.append({
            "time": datetime.fromtimestamp(bucket_epoch, tz=NPT).isoformat(),
            "open": vals[0],
            "high": max(vals),
            "low": min(vals),
            "close": vals[-1],
            "volume": sum(vols),
        })
    return result


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic."""
    global scheduler

    # Startup
    logger.info("Creating database tables...")
    Base.metadata.create_all(bind=engine)

    # Migrate floorsheet table if it uses the old schema (buyer/seller columns, no contract_id)
    with engine.connect() as conn:
        from sqlalchemy import text as sql_text
        has_contract_id = conn.execute(sql_text("""
            SELECT 1 FROM information_schema.columns
            WHERE table_name='floorsheet' AND column_name='contract_id'
        """)).fetchone()
        if not has_contract_id:
            logger.info("Migrating floorsheet table to new schema (dropping old buyer/seller columns)...")
            conn.execute(sql_text("DROP TABLE IF EXISTS floorsheet CASCADE"))
            conn.commit()
            Base.metadata.create_all(bind=engine)
            logger.info("Floorsheet table recreated with new schema")

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
    # Extra origins (comma-separated) for running on another host, e.g. http://aarogya-swift:3000
    allow_origins=["http://localhost:3000", "http://localhost:8080"]
    + [o.strip() for o in os.environ.get("EXTRA_CORS_ORIGINS", "").split(",") if o.strip()],
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
async def get_index_history(
    range: str = Query(default="today", regex="^(today|last_day|5D|1M|3M|6M|1Y)$"),
    interval: str = Query(default=""),
):
    """Get NEPSE index time-series for the given range and interval.

    Primary source: MarketSummary table (real NEPSE index values).
    Fallback: daily average LTP from StockPrice table when summary is sparse (<2 rows).
    """
    from sqlalchemy import func, cast, Date as SADate, text

    range_map = {
        "today":    timedelta(days=1),
        "last_day": timedelta(days=2),  # look back 2 days to capture previous trading day
        "5D":  timedelta(days=10),   # 10 calendar days covers 5 trading days across weekends/holidays
        "1M":  timedelta(days=30),
        "3M":  timedelta(days=90),
        "6M":  timedelta(days=180),
        "1Y":  timedelta(days=365),
    }
    # For today/last_day: use real intraday snapshots (just need 2+ points).
    # For 5D+: require enough distinct calendar days of real data; otherwise the backfill
    # proxy (one point/day) gives a better picture than a handful of intraday snaps.
    min_real_days = {"today": 0, "last_day": 0, "5D": 4, "1M": 14, "3M": 45, "6M": 90, "1Y": 180}

    cutoff = datetime.now(timezone.utc) - range_map[range]
    db = SessionLocal()
    try:
        # For today: use DailyNepseIndexGraph — minute-by-minute intraday data from NepseAPI
        if range == "today" and scheduler is not None:
            raw = await scheduler.provider_manager.get_daily_index_graph()
            if raw:
                # Deduplicate by timestamp, keep last value per second
                seen: dict = {}
                for ts, val in raw:
                    seen[int(ts)] = float(val)
                points_sorted = sorted(seen.items())
                # Build change/changePct relative to first value
                first_val = points_sorted[0][1]
                result = []
                for i, (ts, val) in enumerate(points_sorted):
                    prev = points_sorted[i - 1][1] if i > 0 else val
                    change = round(val - first_val, 2)
                    change_pct = round((change / first_val) * 100, 2) if first_val else 0.0
                    result.append({
                        "time": datetime.fromtimestamp(ts, tz=NPT).isoformat(),
                        "value": val,
                        "change": change,
                        "changePct": change_pct,
                    })
                # Aggregate to requested interval
                int_min = INTERVAL_MINUTES.get(interval or DEFAULT_INTERVAL[range], 1)
                if int_min > 1:
                    result = _aggregate_timeseries(
                        [(datetime.fromisoformat(r["time"]), r["value"]) for r in result],
                        int_min,
                    )
                return result

        # Fetch real MarketSummary data (5-min snapshots during market hours)
        rows = db.query(MarketSummary).filter(
            MarketSummary.time >= cutoff,
            MarketSummary.nepse_index > 0,
        ).order_by(MarketSummary.time.asc()).all()

        eff_interval = interval or DEFAULT_INTERVAL[range]
        int_min = INTERVAL_MINUTES.get(eff_interval, 5)

        # For sub-daily intervals: use real 5-min market_summary snapshots whenever available.
        # Even sparse data (1-2 days) is more accurate than the backfill proxy.
        if rows and eff_interval != "1D":
            rows_iter = ((r.time, r.nepse_index) for r in rows)
            return _aggregate_timeseries(rows_iter, int_min)

        # For 1D interval: prefer historical depth. Use real data only if we have
        # enough calendar days; otherwise fall back to the backfill daily proxy.
        distinct_days = len({r.time.date() for r in rows})
        if rows and (distinct_days >= min_real_days[range] or eff_interval != "1D"):
            rows_iter = ((r.time, r.nepse_index) for r in rows)
            return _aggregate_timeseries(rows_iter, int_min)

        # Fallback: derive a market proxy from daily average LTP across all backfilled stocks.
        # Not the real NEPSE index but provides historical context when market_summary is sparse.
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
            return [
                {"time": _to_npt_iso(r.time), "value": r.nepse_index, "change": r.nepse_change, "changePct": r.nepse_change_pct}
                for r in rows if r.nepse_index > 0
            ]

        # Scale the avg LTP proxy to match the last known real NEPSE index value
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
    """Get the most recent market-wide AI insight. Optional ?type= filter. Never returns stock-specific insights."""
    db = SessionLocal()
    try:
        q = db.query(AIInsight).filter(AIInsight.symbol == None).order_by(AIInsight.generated_at.desc())
        if type:
            q = q.filter(AIInsight.insight_type == type)
        insight = q.first()
        if not insight:
            return None
        return {
            "insight_text": insight.insight_text,
            "insight_type": insight.insight_type,
            "generated_at": _to_npt_iso(insight.generated_at),
            "extra_data": insight.extra_data,
        }
    finally:
        db.close()


@app.get("/api/insights/history")
async def get_insight_history(limit: int = 10):
    """Get recent market-wide AI insights. Never returns stock-specific insights."""
    db = SessionLocal()
    try:
        insights = (
            db.query(AIInsight)
            .filter(AIInsight.symbol == None)
            .order_by(AIInsight.generated_at.desc())
            .limit(min(limit, 50))
            .all()
        )
        return [
            {
                "insight_text": i.insight_text,
                "insight_type": i.insight_type,
                "generated_at": _to_npt_iso(i.generated_at),
                "extra_data": i.extra_data,
            }
            for i in insights
        ]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# AI Memory endpoints
# ---------------------------------------------------------------------------

@app.get("/api/ai/predictions")
async def get_ai_predictions(status: str = "pending", symbol: str = None, limit: int = 20):
    """Get tracked AI predictions with optional status and symbol filters."""
    from .models import AIPrediction
    db = SessionLocal()
    try:
        q = db.query(AIPrediction).order_by(AIPrediction.created_at.desc())
        if status:
            q = q.filter(AIPrediction.status == status)
        if symbol:
            q = q.filter(AIPrediction.symbol == symbol.upper())
        preds = q.limit(min(limit, 50)).all()
        return [
            {
                "id": p.id,
                "prediction_date": str(p.prediction_date),
                "target_date": str(p.target_date) if p.target_date else None,
                "category": p.category,
                "symbol": p.symbol,
                "sector": p.sector,
                "prediction_text": p.prediction_text,
                "conditions": p.conditions,
                "reference_values": p.reference_values,
                "status": p.status,
                "resolution_text": p.resolution_text,
                "resolved_at": _to_npt_iso(p.resolved_at) if p.resolved_at else None,
                "outcome_values": p.outcome_values,
            }
            for p in preds
        ]
    finally:
        db.close()


@app.get("/api/ai/scorecard")
async def get_ai_scorecard(days: int = 30):
    """Get AI prediction hit rate scorecard."""
    from .ai_memory import get_prediction_scorecard
    db = SessionLocal()
    try:
        return get_prediction_scorecard(db, days=min(days, 365))
    finally:
        db.close()


@app.get("/api/ai/regime/history")
async def get_ai_regime_history(days: int = 30):
    """Get market regime history."""
    from .models import AIMarketRegime
    from datetime import date, timedelta
    db = SessionLocal()
    try:
        cutoff = date.today() - timedelta(days=min(days, 365))
        regimes = db.query(AIMarketRegime).filter(
            AIMarketRegime.date >= cutoff
        ).order_by(AIMarketRegime.date.desc()).all()
        return [
            {
                "date": str(r.date),
                "trend": r.trend,
                "trend_strength": r.trend_strength,
                "volatility_regime": r.volatility_regime,
                "breadth_health": r.breadth_health,
                "leading_sectors": r.leading_sectors,
                "lagging_sectors": r.lagging_sectors,
                "nepse_index": r.nepse_index,
                "key_levels": r.key_levels,
                "regime_duration_days": r.regime_duration_days,
                "notes": r.notes,
            }
            for r in regimes
        ]
    finally:
        db.close()


@app.get("/api/ai/patterns")
async def get_ai_patterns(status: str = None):
    """Get AI-identified market patterns."""
    from .models import AIPattern
    db = SessionLocal()
    try:
        q = db.query(AIPattern).order_by(AIPattern.evidence_count.desc())
        if status:
            q = q.filter(AIPattern.status == status)
        else:
            q = q.filter(AIPattern.status.in_(["hypothesis", "emerging", "established"]))
        patterns = q.limit(30).all()
        return [
            {
                "id": p.id,
                "pattern_name": p.pattern_name,
                "description": p.description,
                "category": p.category,
                "evidence_count": p.evidence_count,
                "confirmation_count": p.confirmation_count,
                "last_observed": str(p.last_observed) if p.last_observed else None,
                "last_confirmed": str(p.last_confirmed) if p.last_confirmed else None,
                "status": p.status,
            }
            for p in patterns
        ]
    finally:
        db.close()


@app.get("/api/ai/observations")
async def get_ai_observations(days: int = 7, category: str = None, symbol: str = None, limit: int = 30):
    """Get recent AI market observations."""
    from .models import AIMarketObservation
    from datetime import date, timedelta
    db = SessionLocal()
    try:
        cutoff = date.today() - timedelta(days=min(days, 90))
        q = db.query(AIMarketObservation).filter(
            AIMarketObservation.observation_date >= cutoff,
            AIMarketObservation.still_relevant == True,
        )
        if category:
            q = q.filter(AIMarketObservation.category == category)
        if symbol:
            q = q.filter(AIMarketObservation.symbol == symbol.upper())
        obs = q.order_by(AIMarketObservation.created_at.desc()).limit(min(limit, 100)).all()
        return [
            {
                "id": o.id,
                "observation_date": str(o.observation_date),
                "category": o.category,
                "subcategory": o.subcategory,
                "symbol": o.symbol,
                "sector": o.sector,
                "observation": o.observation,
                "data_snapshot": o.data_snapshot,
                "confidence": o.confidence,
            }
            for o in obs
        ]
    finally:
        db.close()


@app.get("/api/ai/memory/summaries")
async def get_ai_memory_summaries(period_type: str = "weekly", limit: int = 8):
    """Get AI memory summaries (weekly or monthly digests)."""
    from .models import AIMemorySummary
    db = SessionLocal()
    try:
        summaries = db.query(AIMemorySummary).filter(
            AIMemorySummary.period_type == period_type
        ).order_by(AIMemorySummary.period_end.desc()).limit(min(limit, 20)).all()
        return [
            {
                "id": s.id,
                "period_type": s.period_type,
                "period_start": str(s.period_start),
                "period_end": str(s.period_end),
                "summary_text": s.summary_text,
                "key_events": s.key_events,
                "prediction_scorecard": s.prediction_scorecard,
                "market_regime_summary": s.market_regime_summary,
                "sector_performance": s.sector_performance,
                "notable_stocks": s.notable_stocks,
                "created_at": _to_npt_iso(s.created_at),
            }
            for s in summaries
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
async def admin_run_generate_insight(type: str = "daily_close", body: dict = Body(default={})):
    """Manually trigger AI insight generation. type: market_open, hourly, daily_close, weekly_wrap.
    Optional body: {options: {depth: 'brief'|'detailed', focus: ['index','sectors','breadth','movers']}}"""
    if scheduler is None:
        return {"ok": False, "error": "Scheduler not running"}
    options = body.get("options") if body else None
    try:
        from .ai_insights import generate_insight, MARKET_OPEN, HOURLY, WEEKLY_WRAP, DAILY_CLOSE
        db = SessionLocal()
        try:
            await generate_insight(db, scheduler.provider_manager, type, options, force=True)
        finally:
            db.close()
        return {"ok": True, "action": "generate_ai_insight", "type": type}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/stocks/{symbol}/insight")
async def post_stock_insight(symbol: str, body: dict = Body(default={})):
    """Generate a Claude AI insight for a specific stock and persist it.
    Optional body: {options: {horizon, signals, goal}}"""
    from .ai_insights import generate_stock_insight_text, STOCK_INSIGHT
    sym = symbol.upper()
    options = body.get("options") if body else None
    try:
        analysis_resp = await get_stock_analysis(sym)
        analysis = analysis_resp.get("data") if isinstance(analysis_resp, dict) else None
        if not analysis:
            raise HTTPException(404, f"No data for {sym}")
        db = SessionLocal()
        try:
            text = await generate_stock_insight_text(sym, analysis, options, db=db)
        except Exception:
            db.close()
            raise
        if not text:
            db.close()
            raise HTTPException(500, "Empty response from AI")
        try:
            # generate_stock_insight_text already saved the insight when db is provided
            # Fetch the just-saved row to return full data
            row = (
                db.query(AIInsight)
                .filter(AIInsight.symbol == sym, AIInsight.insight_type == STOCK_INSIGHT)
                .order_by(AIInsight.generated_at.desc())
                .first()
            )
            if row:
                return {
                    "insight_text": row.insight_text,
                    "insight_type": STOCK_INSIGHT,
                    "symbol": sym,
                    "generated_at": _to_npt_iso(row.generated_at),
                    "extra_data": row.extra_data,
                }
            # Fallback if not found (shouldn't happen)
            return {
                "insight_text": text,
                "insight_type": STOCK_INSIGHT,
                "symbol": sym,
                "generated_at": _to_npt_iso(datetime.now(timezone.utc)),
                "extra_data": {"model": settings.claude_model_fast},
            }
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stock insight error for {sym}: {e}")
        raise HTTPException(500, str(e))


@app.get("/api/stocks/{symbol}/insight/latest")
async def get_stock_insight_latest(symbol: str):
    """Get the most recent saved AI insight for a specific stock."""
    from .ai_insights import STOCK_INSIGHT
    sym = symbol.upper()
    db = SessionLocal()
    try:
        row = (
            db.query(AIInsight)
            .filter(AIInsight.symbol == sym, AIInsight.insight_type == STOCK_INSIGHT)
            .order_by(AIInsight.generated_at.desc())
            .first()
        )
        if not row:
            return None
        return {
            "insight_text": row.insight_text,
            "insight_type": row.insight_type,
            "symbol": sym,
            "generated_at": _to_npt_iso(row.generated_at),
            "extra_data": row.extra_data,
        }
    finally:
        db.close()


@app.post("/api/stocks/{symbol}/chat")
async def post_stock_chat(symbol: str, body: dict = Body(...)):
    """Conversational AI about a specific stock. Caller sends full message history."""
    from .ai_insights import stock_chat_turn
    sym = symbol.upper()
    messages = body.get("messages", [])
    if not messages:
        raise HTTPException(400, "messages required")
    db = SessionLocal()
    try:
        analysis_resp = await get_stock_analysis(sym)
        analysis = analysis_resp.get("data") if isinstance(analysis_resp, dict) else {}
        response = await stock_chat_turn(sym, analysis or {}, messages, db=db)
        return {"response": response}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stock chat error for {sym}: {e}")
        raise HTTPException(500, str(e))
    finally:
        db.close()


def _serialize_article(article: NewsArticle) -> dict:
    return {
        "id": article.id,
        "title": article.title,
        "link": article.link,
        "summary": article.summary,
        "source": article.source,
        "published_at": _to_npt_iso(article.published_at),
        "fetched_at": _to_npt_iso(article.fetched_at),
        "symbols": article.symbols or [],
        "category": article.category,
    }


@app.get("/api/news")
async def get_news(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    symbol: str | None = None,
    category: str | None = None,
    source: str | None = None,
):
    """Get recent news articles with optional filters."""
    db = SessionLocal()
    try:
        q = db.query(NewsArticle).order_by(NewsArticle.published_at.desc())
        if symbol:
            q = q.filter(NewsArticle.symbols.contains([symbol.upper()]))
        if category:
            q = q.filter(NewsArticle.category == category)
        if source:
            q = q.filter(NewsArticle.source == source)
        total = q.count()
        articles = q.offset(offset).limit(limit).all()
        return {
            "data": [_serialize_article(a) for a in articles],
            "meta": {"total": total, "limit": limit, "offset": offset},
        }
    finally:
        db.close()


@app.get("/api/stocks/{symbol}/news")
async def get_stock_news(symbol: str, limit: int = Query(10, ge=1, le=50)):
    """Get recent news articles mentioning a specific stock symbol."""
    sym = symbol.upper()
    db = SessionLocal()
    try:
        articles = (
            db.query(NewsArticle)
            .filter(NewsArticle.symbols.contains([sym]))
            .order_by(NewsArticle.published_at.desc())
            .limit(limit)
            .all()
        )
        return {"data": [_serialize_article(a) for a in articles]}
    finally:
        db.close()


@app.post("/api/admin/run/ingest-news")
async def admin_run_ingest_news():
    """Manually trigger news ingestion from RSS feeds."""
    if scheduler is None:
        return {"ok": False, "error": "Scheduler not running"}
    try:
        await scheduler.ingest_news()
        return {"ok": True, "action": "ingest_news"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/run/ingest-floorsheet")
async def admin_run_ingest_floorsheet():
    """Manually trigger floorsheet ingestion (ignores market-closed guard)."""
    if scheduler is None:
        return {"ok": False, "error": "Scheduler not running"}
    try:
        raw = await scheduler.provider_manager.get_floorsheet_full()
        if not raw:
            return {"ok": True, "action": "ingest_floorsheet", "inserted": 0, "note": "No data returned"}
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from .models import Floorsheet
        rows = []
        for item in raw:
            contract_id = item.get("contractId")
            symbol = item.get("stockSymbol", "").strip()
            if not contract_id or not symbol:
                continue
            rows.append({
                "contract_id": int(contract_id),
                "symbol": symbol,
                "stock_id": item.get("stockId"),
                "quantity": int(item.get("contractQuantity") or 0),
                "rate": float(item.get("contractRate") or 0),
                "amount": float(item.get("contractAmount") or 0),
                "time": item.get("tradeTime"),
                "business_date": item.get("businessDate"),
                "security_name": item.get("securityName"),
            })
        db = SessionLocal()
        try:
            stmt = pg_insert(Floorsheet).values(rows)
            stmt = stmt.on_conflict_do_nothing(constraint="uq_floorsheet_contract_id")
            result = db.execute(stmt)
            db.commit()
            return {"ok": True, "action": "ingest_floorsheet", "processed": len(rows)}
        finally:
            db.close()
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/stocks/{symbol}/floorsheet")
async def get_symbol_floorsheet(symbol: str, limit: int = 5000, days: int = 1):
    """Get floorsheet trades + analytics for symbol with per-trade anomaly flags.

    Returns every contract for the period, session-level analytics, and anomaly
    flags (volumeSpike, bigAmount, priceDeviation) on each trade.
    """
    from sqlalchemy import text
    import statistics

    symbol = symbol.upper()
    limit = min(limit, 10000)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    db = SessionLocal()
    try:
        # Fetch all trades for the period
        rows = db.execute(text("""
            SELECT contract_no, symbol, buyer, seller, quantity, rate, time
            FROM floorsheet
            WHERE symbol = :sym AND time >= :cutoff
            ORDER BY time DESC
            LIMIT :lim
        """), {"sym": symbol, "cutoff": cutoff, "lim": limit}).fetchall()

        if not rows:
            return {"symbol": symbol, "trades": [], "analytics": None}

        # Compute session-level stats for anomaly detection
        quantities = [r.quantity for r in rows]
        amounts = [r.quantity * r.rate for r in rows]
        rates = [r.rate for r in rows]

        median_qty = statistics.median(quantities)
        avg_amount = statistics.mean(amounts)
        total_volume = sum(quantities)
        total_turnover = sum(amounts)
        vwap = total_turnover / total_volume if total_volume > 0 else 0
        rate_stddev = statistics.stdev(rates) if len(rates) > 1 else 0

        # Anomaly thresholds
        vol_threshold = median_qty * 2
        amt_threshold = avg_amount * 2
        price_threshold = rate_stddev * 2  # 2-sigma

        # Build trade list with anomaly flags
        trades = []
        for r in rows:
            amount = r.quantity * r.rate
            anomalies = []
            if r.quantity > vol_threshold:
                anomalies.append("volumeSpike")
            if amount > amt_threshold:
                anomalies.append("bigAmount")
            if rate_stddev > 0 and abs(r.rate - vwap) > price_threshold:
                anomalies.append("priceDeviation")
            trades.append({
                "contractNo": r.contract_no,
                "symbol": r.symbol,
                "buyer": r.buyer or "—",
                "seller": r.seller or "—",
                "quantity": r.quantity,
                "rate": r.rate,
                "amount": round(amount, 2),
                "time": r.time,
                "anomalies": anomalies,
            })

        analytics = {
            "totalTrades": len(rows),
            "totalVolume": total_volume,
            "totalTurnover": round(total_turnover, 2),
            "vwap": round(vwap, 2),
            "medianTradeSize": round(median_qty, 0),
            "avgTradeSize": round(statistics.mean(quantities), 0),
            "maxTradeSize": max(quantities),
            "rateStddev": round(rate_stddev, 2),
            "priceRange": {
                "high": max(rates),
                "low": min(rates),
            },
            "anomalyThresholds": {
                "volumeSpike": round(vol_threshold, 0),
                "bigAmount": round(amt_threshold, 2),
                "priceDeviation": round(price_threshold, 2),
            },
        }

        return {"symbol": symbol, "trades": trades, "analytics": analytics}
    finally:
        db.close()


@app.get("/api/market/floorsheet-summary")
async def get_market_floorsheet_summary(date: Optional[str] = None):
    """Market-wide floorsheet summary for a given date (default: today).

    Returns total trades/turnover, top symbols by turnover and by trade count,
    block trade leaders, and market-wide trade size profile.
    """
    from sqlalchemy import text
    from datetime import date as date_type
    if date:
        try:
            target_date = date_type.fromisoformat(date)
        except ValueError:
            return {"error": "Invalid date format. Use YYYY-MM-DD."}
    else:
        target_date = datetime.now(NPT).date()

    db = SessionLocal()
    try:
        totals = db.execute(text("""
            SELECT COUNT(*) AS total_trades, SUM(amount) AS total_turnover, AVG(quantity) AS avg_trade_size
            FROM floorsheet WHERE business_date = :d
        """), {"d": target_date}).fetchone()

        if not totals or not totals.total_trades:
            return {"date": target_date.isoformat(), "totalTrades": 0, "totalTurnover": 0, "topByTurnover": [], "topByTrades": [], "blockLeaders": [], "tradeSizeProfile": []}

        top_turnover = db.execute(text("""
            SELECT symbol, SUM(amount) AS turnover, COUNT(*) AS trades,
                   SUM(amount) / NULLIF(SUM(quantity), 0) AS vwap
            FROM floorsheet WHERE business_date = :d
            GROUP BY symbol ORDER BY turnover DESC LIMIT 10
        """), {"d": target_date}).fetchall()

        top_trades = db.execute(text("""
            SELECT symbol, COUNT(*) AS trades, SUM(amount) AS turnover
            FROM floorsheet WHERE business_date = :d
            GROUP BY symbol ORDER BY trades DESC LIMIT 10
        """), {"d": target_date}).fetchall()

        block_leaders = db.execute(text("""
            SELECT symbol,
                   COUNT(*) FILTER (WHERE quantity > 5000) AS block_count,
                   SUM(amount) FILTER (WHERE quantity > 5000) AS block_turnover,
                   SUM(amount) AS total_turnover
            FROM floorsheet WHERE business_date = :d
            GROUP BY symbol
            HAVING COUNT(*) FILTER (WHERE quantity > 5000) > 0
            ORDER BY block_count DESC LIMIT 10
        """), {"d": target_date}).fetchall()

        size_profile = db.execute(text("""
            SELECT
                CASE
                    WHEN quantity <= 100   THEN 'micro'
                    WHEN quantity <= 500   THEN 'small'
                    WHEN quantity <= 2000  THEN 'medium'
                    WHEN quantity <= 5000  THEN 'large'
                    ELSE 'block'
                END AS bucket,
                COUNT(*)    AS trades,
                SUM(amount) AS turnover
            FROM floorsheet WHERE business_date = :d
            GROUP BY bucket ORDER BY MIN(quantity)
        """), {"d": target_date}).fetchall()

        total_turnover = totals.total_turnover or 0
        return {
            "date": target_date.isoformat(),
            "totalTrades": int(totals.total_trades),
            "totalTurnover": round(total_turnover, 2),
            "avgTradeSize": round(totals.avg_trade_size, 0) if totals.avg_trade_size else None,
            "topByTurnover": [
                {
                    "symbol": r.symbol,
                    "turnover": round(r.turnover, 2),
                    "trades": int(r.trades),
                    "vwap": round(r.vwap, 2) if r.vwap else None,
                }
                for r in top_turnover
            ],
            "topByTrades": [
                {"symbol": r.symbol, "trades": int(r.trades), "turnover": round(r.turnover, 2)}
                for r in top_trades
            ],
            "blockLeaders": [
                {
                    "symbol": r.symbol,
                    "blockCount": int(r.block_count),
                    "blockTurnover": round(r.block_turnover or 0, 2),
                    "blockPct": round((r.block_turnover or 0) / max(r.total_turnover, 1) * 100, 1),
                }
                for r in block_leaders
            ],
            "tradeSizeProfile": [
                {
                    "bucket": r.bucket,
                    "trades": int(r.trades),
                    "turnover": round(r.turnover, 2),
                    "tradePct": round(int(r.trades) / max(totals.total_trades, 1) * 100, 1),
                    "turnoverPct": round(r.turnover / max(total_turnover, 1) * 100, 1),
                }
                for r in size_profile
            ],
        }
    finally:
        db.close()


@app.get("/api/stocks/{symbol}/intraday")
async def get_stock_intraday(symbol: str):
    """Get today's minute-by-minute intraday price series for a stock via DailyScripPriceGraph."""
    if scheduler is None:
        return []
    symbol = symbol.upper()
    raw = await scheduler.provider_manager.get_daily_scrip_price_graph(symbol)
    if not raw:
        return []

    # Deduplicate by minute, keep last trade per minute
    from collections import OrderedDict
    by_minute: dict = OrderedDict()
    for item in raw:
        rate = item.get("contractRate") or item.get("rate") or item.get("price")
        qty = item.get("contractQuantity") or item.get("quantity") or 0
        t = item.get("time") or item.get("tradeTime")
        if rate is None or t is None:
            continue
        # Convert epoch seconds → ISO8601 if numeric
        try:
            ts_int = int(t)
            iso_time = datetime.fromtimestamp(ts_int, tz=NPT).isoformat()
        except (ValueError, TypeError):
            iso_time = str(t)
        # Bucket by minute
        minute_key = iso_time[:16]
        by_minute[minute_key] = {"time": iso_time, "value": float(rate), "volume": int(qty)}

    points = list(by_minute.values())
    if not points:
        return []

    first_val = points[0]["value"]
    result = []
    for p in points:
        change = round(p["value"] - first_val, 2)
        change_pct = round((change / first_val) * 100, 2) if first_val else 0.0
        result.append({
            "time": p["time"],
            "value": p["value"],
            "volume": p["volume"],
            "change": change,
            "changePct": change_pct,
        })
    return result


@app.get("/api/sectors/intraday")
async def get_sectors_intraday(
    range: str = Query(default="today", regex="^(today|last_day|5D|1M|3M|6M|1Y)$"),
    interval: str = Query(default=""),
):
    """Get intraday graphs for all 13 NEPSE sector subindices.

    range=today: live NepseAPI sector graphs (1-min native).
    range=last_day/multi-day: persisted intraday_sector_values table (5-min snapshots).
    """
    eff_interval = interval or DEFAULT_INTERVAL[range]
    int_min = INTERVAL_MINUTES.get(eff_interval, 1)

    if range != "today":
        # Query persisted intraday sector values
        db = SessionLocal()
        cutoff = _range_cutoff(range)
        try:
            rows = db.query(IntradaySectorValue).filter(
                IntradaySectorValue.time >= cutoff
            ).order_by(IntradaySectorValue.time.asc()).all()

            # Group by sector
            from collections import defaultdict
            sector_rows: dict[str, list] = defaultdict(list)
            for r in rows:
                sector_rows[r.sector_name].append((r.time, r.value))

            result = {}
            for sector_name, pts in sector_rows.items():
                result[sector_name] = _aggregate_timeseries(pts, int_min)

            # If no data yet (ingestion hasn't started), fall back to live
            if not result and scheduler is not None and range == "last_day":
                raw = await scheduler.provider_manager.get_sector_intraday_graphs()
                for sname, pts in raw.items():
                    if pts:
                        seen = {int(p[0]): float(p[1]) for p in pts if isinstance(p, (list, tuple))}
                        live_iter = [(datetime.fromtimestamp(ts, tz=NPT), val) for ts, val in sorted(seen.items())]
                        result[sname] = _aggregate_timeseries(live_iter, int_min)
            return result
        finally:
            db.close()

    # range=today: use live sector graph endpoints
    if scheduler is None:
        return {}
    raw = await scheduler.provider_manager.get_sector_intraday_graphs()
    result = {}
    for sector_name, points in raw.items():
        if not points:
            result[sector_name] = []
            continue
        # Deduplicate by timestamp
        seen: dict = {}
        for item in points:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                ts, val = int(item[0]), float(item[1])
                seen[ts] = val
        sorted_pts = sorted(seen.items())
        if not sorted_pts:
            result[sector_name] = []
            continue
        live_iter = [(datetime.fromtimestamp(ts, tz=NPT), val) for ts, val in sorted_pts]
        result[sector_name] = _aggregate_timeseries(live_iter, int_min)
    return result


@app.get("/api/stocks/{symbol}/chart")
async def get_stock_chart(
    symbol: str,
    range: str = Query(default="today", regex="^(today|last_day|5D|1M|3M|6M|1Y)$"),
    interval: str = Query(default=""),
):
    """Unified stock chart data. Returns line data for sub-daily intervals, OHLCV for 1D interval."""
    symbol = symbol.upper()
    eff_interval = interval or DEFAULT_INTERVAL[range]
    int_min = INTERVAL_MINUTES.get(eff_interval, 1)
    cutoff = _range_cutoff(range)

    # --- 1D interval: return daily OHLCV from backfill ---
    if eff_interval == "1D":
        db = SessionLocal()
        try:
            rows = (
                db.query(StockPrice)
                .filter(
                    StockPrice.symbol == symbol,
                    StockPrice.time >= cutoff,
                    StockPrice.source == "backfill",
                )
                .order_by(StockPrice.time.asc())
                .all()
            )
            data = [
                {
                    "time": r.time.astimezone(NPT).date().isoformat(),
                    "open": r.open,
                    "high": r.high,
                    "low": r.low,
                    "close": r.close or r.ltp,
                    "volume": r.volume,
                }
                for r in rows
                if (r.close or r.open or r.high or r.low)
            ]
            return {"type": "ohlcv", "interval": eff_interval, "range": range, "data": data}
        finally:
            db.close()

    # --- range=today, sub-daily: use DailyScripPriceGraph (1-min native) ---
    if range == "today" and scheduler is not None:
        raw = await scheduler.provider_manager.get_daily_scrip_price_graph(symbol)
        if raw:
            rows_iter = []
            for item in raw:
                rate = item.get("contractRate") or item.get("rate")
                t = item.get("time") or item.get("tradeTime")
                vol = item.get("contractQuantity") or item.get("quantity") or 0
                if rate is None or t is None:
                    continue
                try:
                    ts_dt = datetime.fromtimestamp(int(t), tz=NPT)
                except (ValueError, TypeError):
                    continue
                rows_iter.append((ts_dt, float(rate), int(vol)))
            # Deduplicate by second
            seen: dict = {}
            for ts_dt, rate, vol in rows_iter:
                seen[int(ts_dt.timestamp())] = (ts_dt, rate, vol)
            sorted_pts = sorted(seen.items())
            if sorted_pts:
                line_data = _aggregate_timeseries(
                    [(ts_dt, rate) for _, (ts_dt, rate, _) in sorted_pts],
                    int_min,
                )
                return {"type": "line", "interval": eff_interval, "range": range, "data": line_data}

    # --- multi-day sub-daily: use stock_prices source='rest' (5-min resolution) ---
    db = SessionLocal()
    try:
        rows = (
            db.query(StockPrice)
            .filter(
                StockPrice.symbol == symbol,
                StockPrice.time >= cutoff,
                StockPrice.source == "rest",
                StockPrice.ltp > 0,
            )
            .order_by(StockPrice.time.asc())
            .all()
        )
        if rows:
            if int_min >= 15:
                # Enough resolution for meaningful OHLCV from 5-min REST snapshots
                data = _aggregate_ohlcv(
                    ((r.time, r.ltp, r.volume) for r in rows),
                    int_min,
                )
                return {"type": "ohlcv", "interval": eff_interval, "range": range, "data": data}
            else:
                data = _aggregate_timeseries(
                    ((r.time, r.ltp) for r in rows),
                    int_min,
                )
                return {"type": "line", "interval": eff_interval, "range": range, "data": data}
        return {"type": "line", "interval": eff_interval, "range": range, "data": []}
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

    # DB fallback: latest market summary row.
    # Determine isOpen by checking NEPSE trading hours (10:45 AM – 3:00 PM NPT, Mon–Fri).
    # NPT is UTC+5:45.
    from datetime import time as dtime
    now_npt = datetime.now(NPT)
    weekday = now_npt.weekday()  # Mon=0 … Sun=6
    t = now_npt.time()
    market_open_time  = dtime(10, 45)
    market_close_time = dtime(15, 0)
    is_trading_day = weekday < 5  # Mon–Fri
    is_open = is_trading_day and market_open_time <= t <= market_close_time

    db = SessionLocal()
    try:
        row = db.query(MarketSummary).order_by(MarketSummary.time.desc()).first()
        if row:
            data = {
                "isOpen": is_open,
                "indices": [
                    {"name": "NEPSE", "value": row.nepse_index, "change": row.nepse_change, "changePct": row.nepse_change_pct},
                ],
                "summary": {
                    "totalTurnover": row.total_turnover,
                    "totalShares": row.total_shares,
                    "totalTransactions": row.total_transactions,
                },
                "lastUpdated": _to_npt_iso(row.time),
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


def _previous_date(db, date_col):
    """Return the most recent date strictly before today (the last completed trading day)."""
    from sqlalchemy import func
    today = datetime.now(NPT).date()
    result = db.query(func.max(date_col)).filter(date_col < today).scalar()
    # If no data before today, fall back to absolute latest (handles weekends / holidays)
    if result is None:
        result = db.query(func.max(date_col)).scalar()
    return result


_RANGE_DAYS = {
    "today": 1,      # current trading day only
    "last_day": 10,  # look back 10 calendar days to find previous trading day
    "5D": 10,
    "1M": 30,
    "3M": 90,
    "6M": 180,
    "1Y": 365,
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
async def get_market_sectors(range: str = Query(default="today", regex="^(today|last_day|5D|1M|3M|6M|1Y)$")):
    """Sector sub-indices. Cache → DB fallback (most recent trading day)."""
    from .cache import get_cache, make_envelope
    from sqlalchemy import func

    cache = get_cache()
    if range == "today":
        cached = cache.get("sectors")
        if cached:
            return cached

    db = SessionLocal()
    try:
        cutoff = _range_cutoff(range)
        latest = _latest_date(db, DailySectorIndex, DailySectorIndex.date)
        if latest:
            if range == "today":
                rows = db.query(DailySectorIndex).filter(
                    DailySectorIndex.date == latest
                ).order_by(DailySectorIndex.change_pct.desc()).all()
                data = [
                    {"name": r.sector_name, "value": r.index_value, "change": r.change, "changePct": r.change_pct}
                    for r in rows
                ]
            elif range == "last_day":
                prev = _previous_date(db, DailySectorIndex.date)
                rows = db.query(DailySectorIndex).filter(
                    DailySectorIndex.date == prev
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
async def get_top_gainers(range: str = Query(default="today", regex="^(today|last_day|5D|1M|3M|6M|1Y)$")):
    """Top gaining stocks. Cache → DB → backfill fallback."""
    from .cache import get_cache, make_envelope

    cache = get_cache()
    if range == "today":
        cached = cache.get("top_gainers")
        if cached:
            return cached

    db = SessionLocal()
    try:
        cutoff = _range_cutoff(range)
        latest = _latest_date(db, DailyTopMover, DailyTopMover.date)
        if latest:
            if range == "today":
                rows = db.query(DailyTopMover).filter(
                    DailyTopMover.date == latest,
                    DailyTopMover.category == "gainer",
                ).order_by(DailyTopMover.rank).all()
                data = [
                    {"rank": r.rank, "symbol": r.symbol, "ltp": r.ltp, "change": r.change, "changePct": r.change_pct}
                    for r in rows
                ]
            elif range == "last_day":
                prev = _previous_date(db, DailyTopMover.date)
                rows = db.query(DailyTopMover).filter(
                    DailyTopMover.date == prev,
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
async def get_top_losers(range: str = Query(default="today", regex="^(today|last_day|5D|1M|3M|6M|1Y)$")):
    """Top losing stocks. Cache → DB → backfill fallback."""
    from .cache import get_cache, make_envelope

    cache = get_cache()
    if range == "today":
        cached = cache.get("top_losers")
        if cached:
            return cached

    db = SessionLocal()
    try:
        cutoff = _range_cutoff(range)
        latest = _latest_date(db, DailyTopMover, DailyTopMover.date)
        if latest:
            if range == "today":
                rows = db.query(DailyTopMover).filter(
                    DailyTopMover.date == latest,
                    DailyTopMover.category == "loser",
                ).order_by(DailyTopMover.rank).all()
                data = [
                    {"rank": r.rank, "symbol": r.symbol, "ltp": r.ltp, "change": r.change, "changePct": r.change_pct}
                    for r in rows
                ]
            elif range == "last_day":
                prev = _previous_date(db, DailyTopMover.date)
                rows = db.query(DailyTopMover).filter(
                    DailyTopMover.date == prev,
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
async def get_top_turnover(range: str = Query(default="today", regex="^(today|last_day|5D|1M|3M|6M|1Y)$")):
    """Top turnover scrips. Cache → DB fallback (most recent trading day)."""
    from .cache import get_cache, make_envelope
    from sqlalchemy import text

    cache = get_cache()
    if range == "today":
        cached = cache.get("top_turnover")
        if cached:
            return cached

    db = SessionLocal()
    try:
        cutoff = _range_cutoff(range)
        latest = _latest_date(db, DailyTopMover, DailyTopMover.date)
        if latest:
            if range == "today":
                rows = db.query(DailyTopMover).filter(
                    DailyTopMover.date == latest,
                    DailyTopMover.category == "turnover",
                ).order_by(DailyTopMover.rank).all()
                data = [
                    {"rank": r.rank, "symbol": r.symbol, "ltp": r.ltp, "turnover": r.turnover}
                    for r in rows
                ]
            elif range == "last_day":
                prev = _previous_date(db, DailyTopMover.date)
                rows = db.query(DailyTopMover).filter(
                    DailyTopMover.date == prev,
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
async def get_market_breadth(range: str = Query(default="today", regex="^(today|last_day|5D|1M|3M|6M|1Y)$")):
    """Market breadth (advance/decline/unchanged). Cache → DB → backfill fallback."""
    from .cache import get_cache, make_envelope
    from sqlalchemy import text

    cache = get_cache()
    if range == "today":
        cached = cache.get("breadth")
        if cached:
            return cached

    db = SessionLocal()
    try:
        cutoff = _range_cutoff(range)
        latest = _latest_date(db, DailyMarketBreadth, DailyMarketBreadth.date)
        if latest:
            if range == "today":
                row = db.query(DailyMarketBreadth).filter(
                    DailyMarketBreadth.date == latest
                ).first()
                if row:
                    return make_envelope({
                        "advances": row.advances, "declines": row.declines,
                        "unchanged": row.unchanged, "total": row.total,
                        "adRatio": row.ad_ratio,
                    }, "db")
            elif range == "last_day":
                prev = _previous_date(db, DailyMarketBreadth.date)
                row = db.query(DailyMarketBreadth).filter(
                    DailyMarketBreadth.date == prev
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
                    "date": r.time.astimezone(NPT).date().isoformat(),
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
        # --- Fetch price rows for symbol — cap at 2 years to bound memory usage.
        # SMA200 needs ~200 trading days (~10 months), so 2 years is more than sufficient.
        cutoff_2y = datetime.now(timezone.utc) - timedelta(days=730)
        rows = db.query(StockPrice).filter(
            StockPrice.symbol == sym,
            StockPrice.time >= cutoff_2y,
        ).order_by(StockPrice.time.asc()).all()

        if not rows:
            return make_envelope(None, "db")

        # Separate backfill (one row per trading day) from live intraday ("rest" source).
        # Only backfill rows are used for daily technical indicators (SMA, RSI, MACD, etc.)
        # because mixing intraday ticks would corrupt multi-period calculations.
        # The latest live row (if any, ltp > 0) is used for the current price.
        backfill_rows = [r for r in rows if r.source == "backfill"]
        live_rows     = [r for r in rows if r.source != "backfill" and r.ltp and r.ltp > 0]

        # Use backfill for daily data arrays; fall back to all valid rows if no backfill
        daily_rows = backfill_rows if backfill_rows else [r for r in rows if r.ltp and r.ltp > 0]
        if not daily_rows:
            return make_envelope(None, "db")

        closes  = [r.ltp for r in daily_rows]
        highs   = [r.high if r.high  and r.high  > 0 else r.ltp for r in daily_rows]
        lows    = [r.low  if r.low   and r.low   > 0 else r.ltp for r in daily_rows]
        volumes = [r.volume   or 0 for r in daily_rows]
        turnovers = [r.turnover or 0 for r in daily_rows]
        dates   = [r.time.astimezone(NPT).date().isoformat() for r in daily_rows]

        # Current price: prefer latest live row, else last backfill row
        latest_row = live_rows[-1] if live_rows else daily_rows[-1]
        ltp = latest_row.ltp

        # Previous close = last backfill daily close (the close price of the prior trading day)
        prev_close = closes[-1] if (live_rows and closes) else (closes[-2] if len(closes) >= 2 else None)

        # Prefer DB change_percent (NepseAPI provides this reliably via percentageChange).
        # The point change field is often 0 in live data (NepseAPI LiveMarket omits pointChange),
        # so compute it from ltp and prevClose when the stored value is 0.
        change_pct = latest_row.change_percent if latest_row.change_percent is not None else (
            round(((ltp - prev_close) / prev_close) * 100, 2)
            if prev_close and prev_close > 0 else None
        )
        if latest_row.change and latest_row.change != 0:
            change_val = latest_row.change
        elif prev_close:
            change_val = round(ltp - prev_close, 2)
        else:
            change_val = None

        # Override with authoritative daily_top_movers data when available for
        # the most recent trading day. The NepseAPI top-gainers/losers endpoint
        # reports official exchange data (including circuit-limit prices) which
        # is more accurate than the REST intraday snapshot for "today's change".
        # This fixes the discrepancy where a stock at upper circuit (e.g. +10%)
        # shows only +1.67% on the details page because the live_market REST
        # snapshot lags behind the official settlement price.
        latest_mover_date = _latest_date(db, DailyTopMover, DailyTopMover.date)
        if latest_mover_date:
            today_mover = db.query(DailyTopMover).filter(
                DailyTopMover.symbol == sym,
                DailyTopMover.date == latest_mover_date,
            ).first()
            if today_mover and today_mover.ltp and today_mover.ltp > 0:
                ltp = today_mover.ltp
                if today_mover.change_pct is not None:
                    change_pct = today_mover.change_pct
                if today_mover.change is not None:
                    change_val = today_mover.change

        # --- 52W metrics — use daily rows only (backfill has correct daily OHLCV) ---
        now = datetime.now(timezone.utc)
        cutoff_1y = now - timedelta(days=365)
        rows_1y = [r for r in daily_rows if r.time >= cutoff_1y]
        highs_1y = [r.high if r.high and r.high > 0 else r.ltp for r in rows_1y]
        lows_1y  = [r.low  if r.low  and r.low  > 0 else r.ltp for r in rows_1y]

        high52w = max(highs_1y) if highs_1y else max(highs)
        low52w  = min(lows_1y)  if lows_1y  else min(lows)
        all_time_high = max(highs)
        range_pos = round((ltp - low52w) / (high52w - low52w), 3) if high52w != low52w else 0.5

        # --- Period returns (backfill daily closes + today's live ltp as final point) ---
        # Map approximate calendar days → list index lookback
        combined_closes = closes + ([ltp] if live_rows else [])
        lookbacks = {"1d": 1, "5d": 5, "1m": 22, "3m": 66, "6m": 132, "1y": 220}
        returns = {k: period_return(combined_closes, v) for k, v in lookbacks.items()}

        # --- Technical indicators (daily closes only for accurate multi-period TA) ---
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
        # Use today's volume from the latest live row (intraday cumulative) if available,
        # otherwise fall back to the last backfill row.
        vol_latest = (latest_row.volume or 0) if latest_row.volume else (volumes[-1] if volumes else None)
        avg20d_vol  = round(sum(volumes[-20:]) / min(len(volumes), 20), 0) if volumes else None
        avg90d_vol  = round(sum(volumes[-90:]) / min(len(volumes), 90), 0) if volumes else None
        vol_ratio   = round(vol_latest / avg20d_vol, 2) if avg20d_vol and avg20d_vol > 0 else None
        avg_turnover = latest_row.turnover if (live_rows and latest_row.turnover) else (turnovers[-1] if turnovers else None)
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

        # --- Floorsheet insights (last 7 days; broker fields are always null in NepseAPI) ---
        cutoff_fs = datetime.now(timezone.utc) - timedelta(days=7)
        cutoff_fs_date = cutoff_fs.date()

        fs_stats = db.execute(text("""
            SELECT
                SUM(amount) / NULLIF(SUM(quantity), 0)          AS vwap,
                AVG(quantity)                                    AS avg_trade_size,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quantity) AS median_trade_size,
                COUNT(*)                                         AS total_trades,
                SUM(amount)                                      AS total_turnover,
                MAX(quantity)                                    AS max_trade_size
            FROM floorsheet
            WHERE symbol = :sym AND business_date >= :cutoff
        """), {"sym": sym, "cutoff": cutoff_fs_date}).fetchone()

        floorsheet_data = None
        if fs_stats and fs_stats.total_trades and fs_stats.total_trades > 0:
            median_qty = fs_stats.median_trade_size or 0

            block_stats = db.execute(text("""
                SELECT COUNT(*) AS block_count,
                       COALESCE(SUM(amount), 0) AS block_turnover,
                       AVG(quantity) AS avg_block_size
                FROM floorsheet
                WHERE symbol = :sym AND business_date >= :cutoff
                  AND quantity > GREATEST(:median * 3, 5000)
            """), {"sym": sym, "cutoff": cutoff_fs_date, "median": median_qty}).fetchone()

            size_dist = db.execute(text("""
                SELECT
                    CASE
                        WHEN quantity <= 100   THEN 'micro'
                        WHEN quantity <= 500   THEN 'small'
                        WHEN quantity <= 2000  THEN 'medium'
                        WHEN quantity <= 5000  THEN 'large'
                        ELSE 'block'
                    END AS bucket,
                    COUNT(*)   AS trades,
                    SUM(amount) AS turnover
                FROM floorsheet
                WHERE symbol = :sym AND business_date >= :cutoff
                GROUP BY bucket
                ORDER BY MIN(quantity)
            """), {"sym": sym, "cutoff": cutoff_fs_date}).fetchall()

            floorsheet_data = {
                "vwap": round(fs_stats.vwap, 2) if fs_stats.vwap else None,
                "avgTradeSize": round(fs_stats.avg_trade_size, 0) if fs_stats.avg_trade_size else None,
                "medianTradeSize": round(fs_stats.median_trade_size, 0) if fs_stats.median_trade_size else None,
                "totalTrades": int(fs_stats.total_trades),
                "totalTurnover": round(fs_stats.total_turnover, 2) if fs_stats.total_turnover else None,
                "maxTradeSize": int(fs_stats.max_trade_size) if fs_stats.max_trade_size else None,
                "blockTrades": {
                    "count": int(block_stats.block_count),
                    "turnover": round(block_stats.block_turnover, 2),
                    "avgSize": round(block_stats.avg_block_size, 0) if block_stats.avg_block_size else 0,
                } if block_stats else None,
                "sizeDistribution": [
                    {"bucket": r.bucket, "trades": int(r.trades), "turnover": round(r.turnover, 2)}
                    for r in size_dist
                ],
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
                "date": r.time.astimezone(NPT).date().isoformat(),
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
        cache.set(cache_key, envelope, ttl=60)
        return envelope

    finally:
        db.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
