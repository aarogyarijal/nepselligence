"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import engine, Base
from .models import StockPrice, Floorsheet, MarketStatus, AIInsight
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
