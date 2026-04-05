"""APScheduler jobs for NEPSE data ingestion."""

import logging
from datetime import datetime
from sqlalchemy.orm import Session
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import settings
from .models import StockPrice, MarketStatus
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

        # Live prices job: CRITICAL FIX
        # Market hours: 11 AM - 3 PM NPT = 5:15 AM - 9:15 AM UTC
        # Cron: Sun-Thu (wdy=0-3 is Sun-Wed in APScheduler, need to verify)
        # Actually in APScheduler: wdy=6 is Sun, 0-4 is Mon-Fri
        # NEPSE: Sun-Thu = wdy=6,0,1,2,3 (Sun, Mon, Tue, Wed, Thu)
        # But we want to run 11 AM - 3 PM NPT each market day
        # hour='11-15' timezone='Asia/Kathmandu' is CORRECT
        self.scheduler.add_job(
            self.ingest_live_prices,
            CronTrigger(
                hour="11-15",  # 11 AM to 3 PM NPT
                day_of_week="0-4",  # Mon-Fri (0=Mon, 4=Fri); need to handle Sun separately
                timezone=settings.scheduler_timezone,
            ),
            id="ingest_live_prices",
            name="Ingest live prices",
            max_instances=settings.scheduler_max_instances,
            coalesce=True,
            misfire_grace_time=300,
        )

        # Also add Sunday job (day_of_week=6)
        self.scheduler.add_job(
            self.ingest_live_prices,
            CronTrigger(
                hour="11-15",
                day_of_week="6",  # Sunday
                timezone=settings.scheduler_timezone,
            ),
            id="ingest_live_prices_sunday",
            name="Ingest live prices (Sunday)",
            max_instances=settings.scheduler_max_instances,
            coalesce=True,
            misfire_grace_time=300,
        )

        # Floorsheet retention: weekly cleanup
        self.scheduler.add_job(
            self.cleanup_old_floorsheet,
            CronTrigger(
                day_of_week="0",  # Monday
                hour="2",  # 2 AM NPT (low traffic)
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

            now = datetime.utcnow()
            inserted = 0

            for item in live_data:
                try:
                    price = StockPrice(
                        symbol=item.get("symbol"),
                        ltp=float(item.get("ltp", 0)),
                        high=float(item.get("high", 0)) if item.get("high") else None,
                        low=float(item.get("low", 0)) if item.get("low") else None,
                        open=float(item.get("open", 0)) if item.get("open") else None,
                        close=float(item.get("close", 0)) if item.get("close") else None,
                        change=float(item.get("change", 0)) if item.get("change") else None,
                        change_percent=float(item.get("changePercent", 0)) if item.get("changePercent") else None,
                        volume=int(item.get("volume", 0)) if item.get("volume") else None,
                        turnover=float(item.get("turnover", 0)) if item.get("turnover") else None,
                        time=now,
                        source="rest",
                    )
                    db.merge(price)  # UNIQUE(time, symbol) + merge = upsert
                    inserted += 1
                except Exception as e:
                    logger.error(f"Failed to insert {item.get('symbol')}: {e}")

            db.commit()
            logger.info(f"Ingested {inserted} prices")

        except Exception as e:
            logger.error(f"Live prices job failed: {e}")
            db.rollback()
        finally:
            db.close()

    async def cleanup_old_floorsheet(self):
        """Delete floorsheet rows older than 90 days."""
        db = self.db_session_factory()
        try:
            from sqlalchemy import delete
            from datetime import timedelta

            cutoff = datetime.utcnow() - timedelta(days=90)
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
