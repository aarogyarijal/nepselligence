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
    DailyMarketBreadth, DailySectorIndex, DailyTopMover,
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
        # Market hours: 11 AM - 3 PM NPT
        market_trigger = CronTrigger(
            hour="11-15",
            day_of_week="0-3,6",  # Mon-Thu (0-3) + Sun (6) = NEPSE trading days
            timezone=settings.scheduler_timezone,
        )

        # Market snapshot job: runs every 60s during market hours (sectors, breadth, movers)
        self.scheduler.add_job(
            self.ingest_market_snapshot,
            market_trigger,
            id="ingest_market_snapshot",
            name="Ingest market snapshot (sectors/breadth/movers)",
            max_instances=1,
            coalesce=True,
            misfire_grace_time=300,
        )

        # Live prices job: runs every minute during market hours
        self.scheduler.add_job(
            self.ingest_live_prices,
            market_trigger,
            id="ingest_live_prices",
            name="Ingest live prices",
            max_instances=settings.scheduler_max_instances,
            coalesce=True,
            misfire_grace_time=300,
        )

        # Market summary + NEPSE index job: runs alongside live prices
        self.scheduler.add_job(
            self.ingest_market_summary,
            CronTrigger(
                hour="11-15",
                day_of_week="0-3,6",  # Mon-Thu (0-3) + Sun (6) = NEPSE trading days
                timezone=settings.scheduler_timezone,
            ),
            id="ingest_market_summary",
            name="Ingest NEPSE index + market summary",
            max_instances=settings.scheduler_max_instances,
            coalesce=True,
            misfire_grace_time=300,
        )

        # AI insights: run at market close (3:15 PM NPT) each trading day
        self.scheduler.add_job(
            self.generate_ai_insight,
            CronTrigger(
                hour="15",
                minute="15",
                day_of_week="0-3,6",  # Mon-Thu (0-3) + Sun (6) = NEPSE trading days
                timezone=settings.scheduler_timezone,
            ),
            id="generate_ai_insight",
            name="Generate AI market insight",
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
                symbol = item.get("symbol")
                if not symbol:
                    continue
                rows.append({
                    "symbol": symbol,
                    "ltp": float(item.get("ltp", 0)),
                    "high": float(item["high"]) if item.get("high") else None,
                    "low": float(item["low"]) if item.get("low") else None,
                    "open": float(item["open"]) if item.get("open") else None,
                    "close": float(item["close"]) if item.get("close") else None,
                    "change": float(item["change"]) if item.get("change") else None,
                    "change_percent": float(item["changePercent"]) if item.get("changePercent") else None,
                    "volume": int(item["volume"]) if item.get("volume") else None,
                    "turnover": float(item["turnover"]) if item.get("turnover") else None,
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

            # NepseAPI /NepseIndex returns a list; find the main NEPSE index
            if isinstance(index_data, list):
                for entry in index_data:
                    if entry.get("index") == "NEPSE Index" or entry.get("indexName") == "NEPSE":
                        nepse_index = float(entry.get("currentValue", 0) or entry.get("value", 0) or 0)
                        nepse_change = float(entry.get("change", 0) or 0)
                        nepse_change_pct = float(entry.get("perChange", 0) or entry.get("changePercent", 0) or 0)
                        break
                if nepse_index is None and index_data:
                    # fallback: use first entry
                    entry = index_data[0]
                    nepse_index = float(entry.get("currentValue", 0) or entry.get("value", 0) or 0)
                    nepse_change = float(entry.get("change", 0) or 0)
                    nepse_change_pct = float(entry.get("perChange", 0) or entry.get("changePercent", 0) or 0)
            elif isinstance(index_data, dict):
                nepse_index = float(index_data.get("currentValue", 0) or index_data.get("value", 0) or 0)
                nepse_change = float(index_data.get("change", 0) or 0)
                nepse_change_pct = float(index_data.get("perChange", 0) or index_data.get("changePercent", 0) or 0)

            if nepse_index is None:
                logger.warning("Could not extract NEPSE index value, skipping")
                return

            total_turnover = None
            total_shares = None
            total_transactions = None
            if isinstance(summary_data, dict):
                total_turnover = float(summary_data.get("totalTurnover", 0) or 0)
                total_shares = int(summary_data.get("totalTradedShares", 0) or 0)
                total_transactions = int(summary_data.get("totalTransactions", 0) or 0)

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

    async def generate_ai_insight(self):
        """Generate AI market insight at close of trading day."""
        db = self.db_session_factory()
        try:
            from .ai_insights import generate_market_insight
            await generate_market_insight(db, self.provider_manager)
        except Exception as e:
            logger.error(f"AI insight generation failed: {e}")
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
