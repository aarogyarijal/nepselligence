"""
One-shot historical data backfill from NepseAPI.

Populates:
  - stock_prices: daily close prices for all active equities (up to 1 year)
  - market_summary: NEPSE index snapshot for today (live endpoints only)

Usage:
  docker compose exec backend python -m backend.backfill
  docker compose exec backend python -m backend.backfill --days 30
  docker compose exec backend python -m backend.backfill --symbols NABIL,ADBL,EIC
"""

import asyncio
import argparse
import logging
from datetime import datetime, timezone, date, timedelta

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .config import settings
from .database import SessionLocal, engine, Base
from .models import StockPrice, MarketSummary

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

NEPSE_API = settings.nepse_api_url.rstrip("/")
CONCURRENCY = 2  # parallel symbol fetches (NepseAPI rate limit: 60 req/min)


async def fetch_company_list(client: httpx.AsyncClient) -> list[dict]:
    """Return all active equity symbols from NepseAPI."""
    resp = await client.get(f"{NEPSE_API}/CompanyList", timeout=30)
    resp.raise_for_status()
    companies = resp.json()
    return [c for c in companies if c.get("status") == "A" and c.get("instrumentType") == "Equity"]


async def fetch_price_history(client: httpx.AsyncClient, symbol: str) -> list[dict]:
    """Return daily price history for a symbol. Retries on 429 with backoff."""
    for attempt in range(4):
        try:
            resp = await client.get(
                f"{NEPSE_API}/PriceVolumeHistory",
                params={"symbol": symbol},
                timeout=30,
            )
            if resp.status_code == 429:
                wait = 2 ** attempt * 10  # 10s, 20s, 40s, 80s
                logger.warning(f"  {symbol}: rate limited, waiting {wait}s (attempt {attempt+1})")
                await asyncio.sleep(wait)
                continue
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                wait = 2 ** attempt * 10
                logger.warning(f"  {symbol}: rate limited, waiting {wait}s (attempt {attempt+1})")
                await asyncio.sleep(wait)
                continue
            logger.warning(f"  {symbol}: fetch failed — {e}")
            return []
        except Exception as e:
            logger.warning(f"  {symbol}: fetch failed — {e}")
            return []
    logger.warning(f"  {symbol}: gave up after 4 rate-limit retries")
    return []


async def fetch_nepse_index(client: httpx.AsyncClient) -> dict | None:
    """Return current NEPSE index snapshot."""
    try:
        resp = await client.get(f"{NEPSE_API}/NepseIndex", timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict):
            return data.get("NEPSE Index") or next(iter(data.values()), None)
        if isinstance(data, list):
            return next((e for e in data if "NEPSE" in e.get("index", "")), data[0] if data else None)
    except Exception as e:
        logger.warning(f"NepseIndex fetch failed: {e}")
    return None


def date_to_utc(d: date) -> datetime:
    """Convert a Nepal business date to UTC midnight (approximate)."""
    # NPT is UTC+5:45; treat businessDate as NPT noon → UTC 06:15
    return datetime(d.year, d.month, d.day, 6, 15, 0, tzinfo=timezone.utc)


async def backfill_stocks(symbols: list[str], days: int):
    """Fetch and insert daily price history for given symbols."""
    cutoff = date.today() - timedelta(days=days)
    db = SessionLocal()

    semaphore = asyncio.Semaphore(CONCURRENCY)
    total_inserted = 0

    async def process_symbol(client: httpx.AsyncClient, symbol: str):
        nonlocal total_inserted
        async with semaphore:
            await asyncio.sleep(1)  # ~2 req/s with CONCURRENCY=2 → stays under 60 req/min
            rows = await fetch_price_history(client, symbol)
            if not rows:
                return

            values = []
            for row in rows:
                try:
                    bdate = date.fromisoformat(row["businessDate"])
                except (KeyError, ValueError):
                    continue
                if bdate < cutoff:
                    continue

                close = row.get("closePrice") or row.get("lastTradedPrice")
                if close is None:
                    continue

                values.append({
                    "symbol": symbol,
                    "ltp": float(close),
                    "high": float(row["highPrice"]) if row.get("highPrice") else None,
                    "low": float(row["lowPrice"]) if row.get("lowPrice") else None,
                    "open": None,
                    "close": float(close),
                    "change": None,
                    "change_percent": None,
                    "volume": int(row["totalTradedQuantity"]) if row.get("totalTradedQuantity") else None,
                    "turnover": float(row["totalTradedValue"]) if row.get("totalTradedValue") else None,
                    "time": date_to_utc(bdate),
                    "source": "backfill",
                })

            if not values:
                logger.info(f"  {symbol}: no rows in range")
                return

            try:
                stmt = pg_insert(StockPrice).values(values)
                stmt = stmt.on_conflict_do_nothing(constraint="uq_price_time_symbol")
                db.execute(stmt)
                db.commit()
                total_inserted += len(values)
                logger.info(f"  {symbol}: inserted {len(values)} rows")
            except Exception as e:
                logger.error(f"  {symbol}: DB insert failed — {e}")
                db.rollback()

    async with httpx.AsyncClient() as client:
        tasks = [process_symbol(client, s) for s in symbols]
        await asyncio.gather(*tasks)

    db.close()
    logger.info(f"Stock backfill complete: {total_inserted} rows across {len(symbols)} symbols")
    return total_inserted


async def backfill_index():
    """Insert today's NEPSE index snapshot into market_summary."""
    db = SessionLocal()
    try:
        async with httpx.AsyncClient() as client:
            index = await fetch_nepse_index(client)
            summary_resp = await client.get(f"{NEPSE_API}/Summary", timeout=30)
            summary = summary_resp.json() if summary_resp.status_code == 200 else {}

        if not index:
            logger.warning("No index data returned, skipping market_summary backfill")
            return 0

        nepse_index = float(index.get("currentValue") or index.get("close") or 0)
        nepse_change = float(index.get("change") or 0)
        nepse_change_pct = float(index.get("perChange") or 0)

        # Use generatedTime if available, else now
        generated_time_str = index.get("generatedTime")
        if generated_time_str:
            # generatedTime is NPT (no tz info in response), convert to UTC
            naive = datetime.fromisoformat(generated_time_str)
            npt_offset = timedelta(hours=5, minutes=45)
            ts = (naive - npt_offset).replace(tzinfo=timezone.utc)
        else:
            ts = datetime.now(timezone.utc)

        stmt = pg_insert(MarketSummary).values(
            time=ts,
            nepse_index=nepse_index,
            nepse_change=nepse_change,
            nepse_change_pct=nepse_change_pct,
            total_turnover=float(summary.get("Total Turnover Rs:", 0) or 0),
            total_shares=int(summary.get("Total Traded Shares", 0) or 0),
            total_transactions=int(summary.get("Total Transactions", 0) or 0),
        )
        stmt = stmt.on_conflict_do_nothing(constraint="uq_summary_time")
        db.execute(stmt)
        db.commit()
        logger.info(f"Index snapshot inserted: NEPSE={nepse_index} change={nepse_change_pct}%")
        return 1
    except Exception as e:
        logger.error(f"Index backfill failed: {e}")
        db.rollback()
        return 0
    finally:
        db.close()


async def main(days: int, symbols: list[str] | None):
    # Ensure tables exist
    Base.metadata.create_all(bind=engine)

    # Resolve symbols
    if symbols:
        logger.info(f"Backfilling {len(symbols)} specified symbols over {days} days")
    else:
        logger.info("Fetching company list...")
        async with httpx.AsyncClient() as client:
            companies = await fetch_company_list(client)
        symbols = [c["symbol"] for c in companies]
        logger.info(f"Found {len(symbols)} active equities — backfilling {days} days each")

    # Run both backfills
    await asyncio.gather(
        backfill_stocks(symbols, days),
        backfill_index(),
    )
    logger.info("Backfill complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill historical NEPSE data")
    parser.add_argument("--days", type=int, default=365, help="Days of history to load (default: 365)")
    parser.add_argument(
        "--symbols",
        type=str,
        default=None,
        help="Comma-separated symbols to backfill (default: all active equities)",
    )
    args = parser.parse_args()

    symbol_list = [s.strip().upper() for s in args.symbols.split(",")] if args.symbols else None
    asyncio.run(main(days=args.days, symbols=symbol_list))
