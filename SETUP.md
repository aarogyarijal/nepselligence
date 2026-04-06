# NEPSE AI Dashboard — Setup Guide

## Quick Start

### 1. Prerequisites
- Docker + Docker Compose
- Python 3.11+
- Git

### 2. Environment Setup

```bash
cp .env.example .env

# Edit .env and add:
# - CLAUDE_API_KEY (if using AI insights; optional for MVP)
# - DATABASE_URL (or use default: postgres://nepselligence:nepselligence@localhost:5432/nepselligence)
```

### 3. Start the full stack

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on `localhost:5432`
- **NepseAPI** (REST :8000, WS :5555, MCP :9000)
- **Backend** (FastAPI :8080 with scheduler)

### 4. Verify setup

```bash
# Check all containers are healthy
docker compose ps

# Verify REST API is live
curl http://localhost:8000/IsNepseOpen
# Expected: {"isOpen":"OPEN","asOf":"2026-04-05T15:00:00"}

# Verify database is created
psql -U nepselligence -h localhost -d nepselligence -c "\dt"
# Expected: stock_prices, floorsheet, market_status, ai_insights tables

# Verify backend health
curl http://localhost:8080/health
# Expected: {"status":"ok","scheduler_running":true}
```

### 5. First data

The scheduler runs live price ingestion:
- **Market hours**: 11 AM - 3 PM NPT (Sun-Thu)
- **Next run**: When NEPSE market opens

To test before market hours, manually trigger:

```bash
# Inside backend container
docker exec nepselligence-backend python -c "
from backend.database import SessionLocal
from backend.scheduler import IngestionScheduler
from backend.providers import NepseAPIProvider, DataProviderManager

provider = NepseAPIProvider('http://nepseapi:8000')
manager = DataProviderManager(provider)
scheduler = IngestionScheduler(manager, SessionLocal)

import asyncio
asyncio.run(scheduler.ingest_live_prices())
"

# Check data was inserted
psql -U nepselligence -h localhost -d nepselligence -c "SELECT COUNT(*) FROM stock_prices;"
```

## Troubleshooting

### "Docker containers not starting"
```bash
docker compose logs -f
```

### "Database connection refused"
```bash
# Wait for postgres to be ready (takes ~5s)
docker compose up postgres -d
sleep 5
docker compose up -d
```

### "Scheduler not running"
Check backend logs:
```bash
docker compose logs -f backend
```

### "Cron job firing at wrong time"
Verify timezone is `Asia/Kathmandu`:
```bash
docker exec nepselligence-backend python -c "
from backend.config import settings
print(f'Scheduler TZ: {settings.scheduler_timezone}')
"
```

## Database Schema

| Table | Purpose | Retention |
|-------|---------|-----------|
| `stock_prices` | Real-time + backfill OHLCV data | All (indexed by symbol, time, ltp) |
| `floorsheet` | Transaction-level trades | 90 days (auto-cleanup weekly) |
| `market_status` | Daily open/closed status | All |
| `market_summaries` | Daily NEPSE index + turnover snapshots | All |
| `ai_insights` | Claude-generated market insights (multi-type) | All |
| `stock_insights` | Per-symbol Claude AI insights | All |
| `daily_sector_index` | Daily sector performance (upserted intraday) | All |
| `daily_market_breadth` | Daily advance/decline/unchanged (upserted intraday) | All |
| `news` | Market and stock news articles | All |

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Server health + scheduler status |
| GET | `/api/market/overview` | NEPSE index, market status, breadth summary |
| GET | `/api/market/sectors?range=1D` | Sector performance |
| GET | `/api/market/top-gainers?range=1D` | Top gaining stocks |
| GET | `/api/market/top-losers?range=1D` | Top losing stocks |
| GET | `/api/market/top-turnover?range=1D` | Highest turnover stocks |
| GET | `/api/market/breadth?range=1D` | Advance/decline/unchanged counts |
| GET | `/api/market/companies` | Full company list for search autocomplete |
| GET | `/api/index/history?range=1D&interval=1min` | NEPSE index OHLCV history |
| GET | `/api/stocks/{symbol}/history` | Stock price history |
| GET | `/api/stocks/{symbol}/chart?range=1D` | Stock chart (line or candlestick) |
| GET | `/api/stocks/{symbol}/analysis` | Technical analysis (SMA, RSI, MACD, BB, signals) |
| GET | `/api/stocks/{symbol}/floorsheet?limit=200&days=30` | Recent trades for symbol |
| GET | `/api/stocks/{symbol}/insight/latest` | Latest AI insight for stock |
| POST | `/api/stocks/{symbol}/insight` | Generate new AI insight for stock |
| POST | `/api/stocks/{symbol}/chat` | Chat with Claude about a stock |
| GET | `/api/stocks/{symbol}/news?limit=10` | News articles for stock |
| GET | `/api/insights/latest?type=daily_close` | Latest market AI insight (optional type filter) |
| GET | `/api/insights/history?limit=10` | Recent market AI insights |
| GET | `/api/news?category=all&limit=20` | Paginated market news |
| GET | `/api/admin/status` | Scheduler job record counts |
| POST | `/api/admin/run/{action}` | Manually trigger scheduler actions |

## Next Steps

- [ ] Deploy Next.js frontend (see FRONTEND.md)
- [ ] Configure Claude API for AI insights
- [ ] Set up monitoring/alerts
- [ ] Configure backup strategy for PostgreSQL
