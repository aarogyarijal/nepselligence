"""APScheduler jobs for NEPSE data ingestion."""

import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import settings
from .models import (
    StockPrice, MarketStatus, Floorsheet, MarketSummary,
    DailyMarketBreadth, DailySectorIndex, DailyTopMover, IntradaySectorValue,
)
from .providers import DataProviderManager

logger = logging.getLogger(__name__)


class IngestionScheduler:
    """Manages scheduled NEPSE data ingestion jobs."""

    def __init__(self, provider_manager: DataProviderManager, db_session_factory):
        self.provider_manager = provider_manager
        self.db_session_factory = db_session_factory
        self.scheduler = AsyncIOScheduler()

    def start(self):
        """Start the scheduler with all jobs."""
        logger.info("Starting scheduler...")

        # NEPSE market days: Sun-Thu (Nepal trades Sun through Thu)
        # Market hours: 11 AM - 3 PM NPT — fires every 5 minutes (matches NepseAPI 10-min cache TTL)
        market_trigger = CronTrigger(
            hour="11-15",
            minute="*/5",
            day_of_week="0-3,6",  # Mon-Thu (0-3) + Sun (6) = NEPSE trading days
            timezone=settings.scheduler_timezone,
        )

        # Market snapshot job: every 5 min during market hours (sectors, breadth, movers)
        self.scheduler.add_job(
            self.ingest_market_snapshot,
            market_trigger,
            id="ingest_market_snapshot",
            name="Ingest market snapshot (sectors/breadth/movers)",
            max_instances=1,
            coalesce=True,
            misfire_grace_time=300,
        )

        # Live prices job: every 5 min during market hours
        self.scheduler.add_job(
            self.ingest_live_prices,
            market_trigger,
            id="ingest_live_prices",
            name="Ingest live prices",
            max_instances=settings.scheduler_max_instances,
            coalesce=True,
            misfire_grace_time=300,
        )

        # Market summary + NEPSE index job: same 5-min cadence
        self.scheduler.add_job(
            self.ingest_market_summary,
            market_trigger,
            id="ingest_market_summary",
            name="Ingest NEPSE index + market summary",
            max_instances=settings.scheduler_max_instances,
            coalesce=True,
            misfire_grace_time=300,
        )

        # AI insights — market open briefing (11:05 AM NPT)
        self.scheduler.add_job(
            self.generate_ai_open_briefing,
            CronTrigger(
                hour="11", minute="5",
                day_of_week="0-3,6",
                timezone=settings.scheduler_timezone,
            ),
            id="generate_ai_open",
            name="Generate AI market open briefing",
            max_instances=1,
            coalesce=True,
            misfire_grace_time=600,
        )

        # AI insights — hourly mid-session update (12:15, 13:15, 14:15 NPT)
        self.scheduler.add_job(
            self.generate_ai_hourly,
            CronTrigger(
                hour="12-14", minute="15",
                day_of_week="0-3,6",
                timezone=settings.scheduler_timezone,
            ),
            id="generate_ai_hourly",
            name="Generate AI hourly market update",
            max_instances=1,
            coalesce=True,
            misfire_grace_time=600,
        )

        # AI insights — daily close summary (3:15 PM NPT)
        self.scheduler.add_job(
            self.generate_ai_insight,
            CronTrigger(
                hour="15", minute="15",
                day_of_week="0-3,6",
                timezone=settings.scheduler_timezone,
            ),
            id="generate_ai_insight",
            name="Generate AI daily close insight",
            max_instances=1,
            coalesce=True,
            misfire_grace_time=600,
        )

        # AI insights — weekly wrap (Thursday 3:30 PM NPT = day_of_week=3)
        self.scheduler.add_job(
            self.generate_ai_weekly,
            CronTrigger(
                day_of_week="3", hour="15", minute="30",
                timezone=settings.scheduler_timezone,
            ),
            id="generate_ai_weekly",
            name="Generate AI weekly wrap",
            max_instances=1,
            coalesce=True,
            misfire_grace_time=600,
        )

        # Floorsheet retention: weekly cleanup on Monday at 2 AM NPT
        self.scheduler.add_job(
            self.cleanup_old_floorsheet,
            CronTrigger(
                day_of_week="mon",
                hour="2",
                timezone=settings.scheduler_timezone,
            ),
            id="cleanup_floorsheet",
            name="Clean old floorsheet",
            max_instances=settings.scheduler_max_instances,
        )

        self.scheduler.start()
        logger.info("Scheduler started with jobs")

    async def ingest_live_prices(self):
        """Fetch live prices and store in DB. Max_instances=1 prevents overlap."""
        db = self.db_session_factory()
        try:
            # CRITICAL: Guard against market closed
            market_status = await self.provider_manager.get_market_status()
            if market_status.get("isOpen") == "CLOSE":
                logger.info("Market closed, aborting ingest")
                return

            # Fetch live market data
            live_data = await self.provider_manager.get_live_market()
            logger.info(f"Fetched {len(live_data)} live prices")

            now = datetime.now(timezone.utc)
            rows = []

            for item in live_data:
                # NepseAPI uses camelCase field names (lastTradedPrice, highPrice, etc.)
                symbol = item.get("symbol")
                if not symbol:
                    continue
                ltp = float(
                    item.get("lastTradedPrice") or item.get("ltp") or
                    item.get("lastTradedPricePerUnit") or 0
                )
                if not ltp:
                    continue  # skip rows with no valid price
                rows.append({
                    "symbol": symbol,
                    "ltp": ltp,
                    "high": float(item["highPrice"]) if item.get("highPrice") else (
                        float(item["high"]) if item.get("high") else None),
                    "low": float(item["lowPrice"]) if item.get("lowPrice") else (
                        float(item["low"]) if item.get("low") else None),
                    "open": float(item["openPrice"]) if item.get("openPrice") else (
                        float(item["open"]) if item.get("open") else None),
                    "close": float(item["previousClose"]) if item.get("previousClose") else (
                        float(item["close"]) if item.get("close") else None),
                    "change": float(
                        item.get("change") or item.get("pointChange") or 0
                    ),
                    "change_percent": float(
                        item.get("percentageChange") or item.get("changePercent") or 0
                    ),
                    "volume": int(item["totalTradeQuantity"]) if item.get("totalTradeQuantity") else (
                        int(item["volume"]) if item.get("volume") else None),
                    "turnover": float(item["totalTradeValue"]) if item.get("totalTradeValue") else (
                        float(item["turnover"]) if item.get("turnover") else None),
                    "time": now,
                    "source": "rest",
                })

            if rows:
                stmt = pg_insert(StockPrice).values(rows)
                stmt = stmt.on_conflict_do_nothing(constraint="uq_price_time_symbol")
                db.execute(stmt)
                db.commit()
                logger.info(f"Ingested {len(rows)} prices")

        except Exception as e:
            logger.error(f"Live prices job failed: {e}")
            db.rollback()
        finally:
            db.close()

    async def ingest_market_summary(self):
        """Fetch NEPSE index + market summary and store in DB."""
        db = self.db_session_factory()
        try:
            market_status = await self.provider_manager.get_market_status()
            if market_status.get("isOpen") == "CLOSE":
                logger.info("Market closed, skipping market summary ingest")
                return

            now = datetime.now(timezone.utc)

            # Fetch NEPSE index
            index_data = await self.provider_manager.get_nepse_index()
            summary_data = await self.provider_manager.get_market_summary()

            nepse_index = None
            nepse_change = None
            nepse_change_pct = None

            # NepseAPI /NepseIndex — handles both list and dict (keyed by index name) formats
            def _extract_index_entry(entry: dict) -> None:
                nonlocal nepse_index, nepse_change, nepse_change_pct
                nepse_index = float(entry.get("currentValue", 0) or entry.get("value", 0) or 0)
                nepse_change = float(entry.get("change", 0) or 0)
                nepse_change_pct = float(entry.get("perChange", 0) or entry.get("changePercent", 0) or 0)

            if isinstance(index_data, list):
                for entry in index_data:
                    if entry.get("index") == "NEPSE Index" or entry.get("indexName") == "NEPSE":
                        _extract_index_entry(entry)
                        break
                if nepse_index is None and index_data:
                    _extract_index_entry(index_data[0])
            elif isinstance(index_data, dict):
                # Format: {"NEPSE Index": {currentValue, change, ...}, "Sensitive Index": {...}, ...}
                if "NEPSE Index" in index_data:
                    _extract_index_entry(index_data["NEPSE Index"])
                elif index_data:
                    # Unknown flat dict format — try direct keys
                    _extract_index_entry(index_data)

            if not nepse_index:
                logger.warning("Could not extract NEPSE index value (got 0 or None), skipping")
                return

            total_turnover = None
            total_shares = None
            total_transactions = None
            if isinstance(summary_data, dict):
                # NepseAPI /Summary uses space-separated keys: "Total Turnover Rs:", "Total Traded Shares", etc.
                total_turnover = float(
                    summary_data.get("Total Turnover Rs:") or summary_data.get("totalTurnover") or 0
                )
                total_shares = int(
                    summary_data.get("Total Traded Shares") or summary_data.get("totalTradedShares") or 0
                )
                total_transactions = int(
                    summary_data.get("Total Transactions") or summary_data.get("totalTransactions") or 0
                )

            stmt = pg_insert(MarketSummary).values(
                time=now,
                nepse_index=nepse_index,
                nepse_change=nepse_change,
                nepse_change_pct=nepse_change_pct,
                total_turnover=total_turnover,
                total_shares=total_shares,
                total_transactions=total_transactions,
            )
            stmt = stmt.on_conflict_do_nothing(constraint="uq_summary_time")
            db.execute(stmt)
            db.commit()
            logger.info(f"Ingested market summary: NEPSE={nepse_index}")

        except Exception as e:
            logger.error(f"Market summary job failed: {e}")
            db.rollback()
        finally:
            db.close()

    async def ingest_market_snapshot(self, force: bool = False):
        """Fetch sectors, breadth, gainers, losers, turnover and write to cache + DB.

        Runs every 60s during market hours. Uses asyncio.gather for one burst of
        NepseAPI calls, then writes results to both in-memory cache and DB tables.
        Pass force=True to bypass market-open check (for manual admin triggers).
        """
        import asyncio
        from datetime import date

        from .cache import get_cache, make_envelope

        if not force:
            market_status = await self.provider_manager.get_market_status()
            if market_status.get("isOpen") == "CLOSE":
                return

        # Fetch all in parallel
        try:
            results = await asyncio.gather(
                self.provider_manager.get_sub_indices(),
                self.provider_manager.get_top_gainers(),
                self.provider_manager.get_top_losers(),
                self.provider_manager.get_top_turnover(),
                self.provider_manager.get_live_market(),
                self.provider_manager.get_nepse_index(),
                self.provider_manager.get_market_summary(),
                return_exceptions=True,
            )
        except Exception as e:
            logger.error(f"Market snapshot gather failed: {e}")
            return

        sub_indices, top_gainers, top_losers, top_turnover, live_market, nepse_index_raw, summary_raw = results

        cache = get_cache()
        today = date.today()
        db = self.db_session_factory()

        try:
            # --- Sectors ---
            if isinstance(sub_indices, list) and sub_indices:
                normalized = []
                for s in sub_indices:
                    normalized.append({
                        "name": s.get("index") or s.get("indexName") or s.get("name", ""),
                        "value": float(s.get("currentValue") or s.get("value") or 0),
                        "change": float(s.get("change") or 0),
                        "changePct": float(s.get("perChange") or s.get("changePercent") or 0),
                    })
                cache.set("sectors", make_envelope(normalized, "live"), ttl=300)
                # Persist intraday sector time-series (5-min resolution for multi-day charts)
                now_ts = datetime.now(timezone.utc)
                for row in normalized:
                    if row["value"] and row["value"] > 0:
                        stmt = pg_insert(IntradaySectorValue).values(
                            sector_name=row["name"],
                            time=now_ts,
                            value=row["value"],
                        )
                        stmt = stmt.on_conflict_do_nothing(constraint="uq_sector_intraday")
                        db.execute(stmt)
                # Persist to DB (upsert per sector per date)
                for row in normalized:
                    stmt = pg_insert(DailySectorIndex).values(
                        date=today,
                        sector_name=row["name"],
                        index_value=row["value"],
                        change=row["change"],
                        change_pct=row["changePct"],
                    )
                    stmt = stmt.on_conflict_do_nothing(constraint="uq_sector_date")
                    db.execute(stmt)

            # --- Top Gainers ---
            if isinstance(top_gainers, list) and top_gainers:
                normalized_g = []
                for i, s in enumerate(top_gainers[:20]):
                    normalized_g.append({
                        "rank": i + 1,
                        "symbol": s.get("symbol", ""),
                        "ltp": float(s.get("ltp") or s.get("lastTradedPrice") or 0),
                        "change": float(s.get("change") or s.get("pointChange") or 0),
                        "changePct": float(s.get("changePercent") or s.get("pctChange") or s.get("perChange") or 0),
                        "turnover": float(s.get("turnover") or 0),
                    })
                cache.set("top_gainers", make_envelope(normalized_g, "live"), ttl=60)
                stmt = pg_insert(DailyTopMover).values([
                    dict(date=today, category="gainer", rank=r["rank"], symbol=r["symbol"],
                         ltp=r["ltp"], change=r["change"], change_pct=r["changePct"], turnover=r["turnover"])
                    for r in normalized_g
                ])
                stmt = stmt.on_conflict_do_nothing(constraint="uq_mover_date_category_rank")
                db.execute(stmt)

            # --- Top Losers ---
            if isinstance(top_losers, list) and top_losers:
                normalized_l = []
                for i, s in enumerate(top_losers[:20]):
                    normalized_l.append({
                        "rank": i + 1,
                        "symbol": s.get("symbol", ""),
                        "ltp": float(s.get("ltp") or s.get("lastTradedPrice") or 0),
                        "change": float(s.get("change") or s.get("pointChange") or 0),
                        "changePct": float(s.get("changePercent") or s.get("pctChange") or s.get("perChange") or 0),
                        "turnover": float(s.get("turnover") or 0),
                    })
                cache.set("top_losers", make_envelope(normalized_l, "live"), ttl=60)
                stmt = pg_insert(DailyTopMover).values([
                    dict(date=today, category="loser", rank=r["rank"], symbol=r["symbol"],
                         ltp=r["ltp"], change=r["change"], change_pct=r["changePct"], turnover=r["turnover"])
                    for r in normalized_l
                ])
                stmt = stmt.on_conflict_do_nothing(constraint="uq_mover_date_category_rank")
                db.execute(stmt)

            # --- Top Turnover ---
            if isinstance(top_turnover, list) and top_turnover:
                normalized_t = []
                for i, s in enumerate(top_turnover[:10]):
                    normalized_t.append({
                        "rank": i + 1,
                        "symbol": s.get("symbol", ""),
                        "ltp": float(s.get("ltp") or s.get("closingPrice") or 0),
                        "turnover": float(s.get("turnover") or 0),
                    })
                cache.set("top_turnover", make_envelope(normalized_t, "live"), ttl=60)
                stmt = pg_insert(DailyTopMover).values([
                    dict(date=today, category="turnover", rank=r["rank"], symbol=r["symbol"],
                         ltp=r["ltp"], change=None, change_pct=None, turnover=r["turnover"])
                    for r in normalized_t
                ])
                stmt = stmt.on_conflict_do_nothing(constraint="uq_mover_date_category_rank")
                db.execute(stmt)

            # --- Market Breadth (derived from live_market) ---
            if isinstance(live_market, list) and live_market:
                advances = sum(1 for s in live_market if (s.get("change") or 0) > 0)
                declines = sum(1 for s in live_market if (s.get("change") or 0) < 0)
                unchanged = len(live_market) - advances - declines
                total = len(live_market)
                ad_ratio = round(advances / declines, 2) if declines > 0 else None
                breadth = {
                    "advances": advances,
                    "declines": declines,
                    "unchanged": unchanged,
                    "total": total,
                    "adRatio": ad_ratio,
                }
                cache.set("breadth", make_envelope(breadth, "live"), ttl=60)
                stmt = pg_insert(DailyMarketBreadth).values(
                    date=today, advances=advances, declines=declines,
                    unchanged=unchanged, total=total, ad_ratio=ad_ratio,
                )
                stmt = stmt.on_conflict_do_nothing()
                db.execute(stmt)

            # --- Market Overview (cache only, DB handled by ingest_market_summary) ---
            if not isinstance(nepse_index_raw, Exception) and isinstance(nepse_index_raw, list):
                indices = []
                for entry in nepse_index_raw:
                    indices.append({
                        "name": entry.get("index") or entry.get("indexName") or "",
                        "value": float(entry.get("currentValue") or entry.get("value") or 0),
                        "change": float(entry.get("change") or 0),
                        "changePct": float(entry.get("perChange") or entry.get("changePercent") or 0),
                    })
                summary_dict = {}
                if not isinstance(summary_raw, Exception) and isinstance(summary_raw, dict):
                    summary_dict = {
                        "totalTurnover": float(summary_raw.get("totalTurnover") or 0),
                        "totalShares": int(summary_raw.get("totalTradedShares") or 0),
                        "totalTransactions": int(summary_raw.get("totalTransactions") or 0),
                    }
                overview = {
                    "isOpen": True,
                    "indices": indices,
                    "summary": summary_dict,
                    "lastUpdated": datetime.now(timezone.utc).isoformat(),
                }
                cache.set("market_overview", make_envelope(overview, "live"), ttl=60)

            db.commit()
            logger.info("Market snapshot ingested: sectors/breadth/movers cached + persisted")

        except Exception as e:
            logger.error(f"Market snapshot DB write failed: {e}")
            db.rollback()
        finally:
            db.close()

    async def generate_ai_open_briefing(self):
        """Generate market open briefing at 11:05 AM NPT."""
        db = self.db_session_factory()
        try:
            from .ai_insights import generate_insight, MARKET_OPEN
            await generate_insight(db, self.provider_manager, MARKET_OPEN)
        except Exception as e:
            logger.error(f"AI open briefing failed: {e}")
        finally:
            db.close()

    async def generate_ai_hourly(self):
        """Generate hourly mid-session update."""
        db = self.db_session_factory()
        try:
            from .ai_insights import generate_insight, HOURLY
            await generate_insight(db, self.provider_manager, HOURLY)
        except Exception as e:
            logger.error(f"AI hourly insight failed: {e}")
        finally:
            db.close()

    async def generate_ai_insight(self):
        """Generate AI daily close insight at 3:15 PM NPT."""
        db = self.db_session_factory()
        try:
            from .ai_insights import generate_insight, DAILY_CLOSE
            await generate_insight(db, self.provider_manager, DAILY_CLOSE)
        except Exception as e:
            logger.error(f"AI daily close insight failed: {e}")
        finally:
            db.close()

    async def generate_ai_weekly(self):
        """Generate weekly wrap on Thursday at 3:30 PM NPT."""
        db = self.db_session_factory()
        try:
            from .ai_insights import generate_insight, WEEKLY_WRAP
            await generate_insight(db, self.provider_manager, WEEKLY_WRAP)
        except Exception as e:
            logger.error(f"AI weekly wrap failed: {e}")
        finally:
            db.close()

    async def cleanup_old_floorsheet(self):
        """Delete floorsheet rows older than 90 days."""
        db = self.db_session_factory()
        try:
            from sqlalchemy import delete
            from datetime import timedelta

            cutoff = datetime.now(timezone.utc) - timedelta(days=90)
            stmt = delete(Floorsheet).where(Floorsheet.time < cutoff)
            result = db.execute(stmt)
            db.commit()
            logger.info(f"Deleted {result.rowcount} old floorsheet rows")
        except Exception as e:
            logger.error(f"Floorsheet cleanup failed: {e}")
            db.rollback()
        finally:
            db.close()

    def stop(self):
        """Stop the scheduler."""
        self.scheduler.shutdown()
        logger.info("Scheduler stopped")
