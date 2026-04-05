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
| `stock_prices` | Real-time OHLCV data | All (indexed by symbol, time) |
| `floorsheet` | Transaction-level trades | 90 days (auto-cleanup weekly) |
| `market_status` | Daily open/closed status | All |
| `ai_insights` | Claude-generated insights | All |

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Server health + scheduler status |
| GET | `/api/stocks/latest` | Latest price for all symbols |
| GET | `/api/stocks/{symbol}/floorsheet` | Recent trades for symbol |

## Next Steps

- [ ] Deploy Next.js frontend (see FRONTEND.md)
- [ ] Configure Claude API for AI insights
- [ ] Set up monitoring/alerts
- [ ] Configure backup strategy for PostgreSQL
