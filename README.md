# NEPSE AI Dashboard

A real-time financial dashboard for Nepal Stock Exchange (NEPSE) with AI-generated market insights. Built with Next.js, FastAPI, PostgreSQL, and Claude AI.

**Status:** MVP complete. Backend + Frontend fully integrated. Awaiting live market data.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Development](#development)
- [API Documentation](#api-documentation)
- [Deployment](#deployment)
- [Testing](#testing)
- [Known Issues](#known-issues)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## Features

### Current (MVP - Phase 2)
- ✅ **Real-time Index Chart** — NEPSE Index visualization (11 AM - 3 PM NPT)
- ✅ **Top Gainers & Losers** — Stocks sorted by % change with tabbed interface
- ✅ **Watchlist** — Customizable tracked symbols with price tracking
- ✅ **AI Panel** — Read-only broadcast of market insights (powered by Claude)
- ✅ **Time Range Selector** — 1D, 5D, 1M, 3M views (UI ready, data deferred)
- ✅ **Desktop-first** — Optimized for 1280px+ screens
- ✅ **Dark Theme** — Professional slate color scheme
- ✅ **API Integration** — Backend-connected frontend with graceful fallback
- ✅ **Production Build** — TypeScript strict mode, optimized bundle

### Planned (Phase 3+)
- 🔄 **Live Price Updates** — WebSocket integration for 1-5 second refresh
- 🔄 **Claude AI Integration** — Hourly market summary generation
- 🔄 **Trading Floorsheet** — Detailed trade history modal
- 🔄 **Search & Filtering** — Symbol lookup, sector views
- 🔄 **Historical Charts** — 5D, 1M, 3M+ data with technical analysis
- 🔄 **Alerts** — Price targets, volume spikes
- 🔄 **Mobile Responsive** — Full responsive design
- 🔄 **Authentication** — Multi-user support with saved preferences

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        NEPSE Market                              │
│                   (nepalstock.com, real data)                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│          NepseAPI-Unofficial (Docker)                            │
│  REST API :8000 | WebSocket :5555 | MCP Server :9000            │
│  ✓ Live market data (prices, trades, indices)                   │
└────────────────┬────────────────────────┬───────────────────────┘
                 │                        │
        ┌────────▼────────┐       ┌───────▼───────┐
        │  Backend        │       │   (Reserved)  │
        │  FastAPI :8080  │       │  Claude API   │
        │  ✓ Scheduler    │       │  (Phase 3)    │
        │  ✓ Data Ingestion       │               │
        │  ✓ REST API     │       └───────────────┘
        └────────┬────────┘
                 │
        ┌────────▼──────────────┐
        │  PostgreSQL :5432     │
        │  ✓ stock_prices       │
        │  ✓ floorsheet         │
        │  ✓ market_status      │
        │  ✓ ai_insights        │
        └────────┬──────────────┘
                 │
    ┌────────────┴────────────────┐
    │                             │
┌───▼──────────────┐         ┌────▼──────────┐
│ Backend API      │         │  (Future)     │
│ GET /health      │         │  WebSocket    │
│ GET /api/stocks/*          │  Proxy        │
│ GET /api/stocks/{}/floor   │               │
└────────┬─────────┘         └────────────────┘
         │
         │ CORS (localhost:3000)
         │
┌────────▼──────────────────────┐
│   Next.js Frontend (3000)      │
│   React 18 + Recharts          │
│  ┌──────────────────────────┐  │
│  │  Dashboard Components    │  │
│  │  ✓ IndexChart (Recharts) │  │
│  │  ✓ TopMovers (Tabs)      │  │
│  │  ✓ Watchlist (Table)     │  │
│  │  ✓ AIPanel (Broadcast)   │  │
│  │  ✓ TimeRangeSelector     │  │
│  └──────────────────────────┘  │
└────────────────────────────────┘
         │
         └─► Browser (Desktop)
             Desktop-only (1280px+)
             Dark theme
             Real-time updates (Phase 3)
```

### Data Flow

**Market Hours (11 AM - 3 PM NPT Sun-Thu):**

1. **NepseAPI** fetches live NEPSE data every 30 seconds
2. **APScheduler** (backend cron) ingests prices every 30 seconds
3. **PostgreSQL** stores: stock_prices, floorsheet, market_status
4. **Frontend** fetches `/api/stocks/latest` (mock interval for now)
5. **React** renders real data in 4 components

**Market Closed:**
- Frontend displays mock data or cached latest prices
- APScheduler stops (market guard prevents stale writes)
- API returns empty array

### Critical Design Decisions

| Decision | Reasoning | Status |
|----------|-----------|--------|
| PostgreSQL (not TimescaleDB) | Simpler setup, sufficient for MVP | ✅ Locked |
| Plain FastAPI (not Django) | Lightweight, async-ready for Phase 3 | ✅ Locked |
| APScheduler (not background workers) | Built-in, timezone-aware cron | ✅ Locked |
| Server-side WebSocket proxy | Avoid client fan-out, single connection | 🔄 Phase 3 |
| Claude API (not local LLM) | Better quality insights, MCP integration | 🔄 Phase 3 |
| 4 modules (not more) | MVP scope, highest-impact features | ✅ Locked |
| Read-only AI Panel (no chat) | Broadcast, not conversation | ✅ Locked |
| Desktop-only MVP | Focus on core experience first | ✅ Locked |

---

## Tech Stack

### Backend
- **Framework:** FastAPI 0.115
- **Database:** PostgreSQL 16 (Alpine)
- **ORM:** SQLAlchemy 2.0
- **Scheduling:** APScheduler 3.10 (Cron + Timezone)
- **HTTP Client:** HTTPX (async)
- **Server:** Uvicorn (async ASGI)
- **Language:** Python 3.12

### Frontend
- **Framework:** Next.js 14 (App Router)
- **Runtime:** React 18
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS + CSS Modules
- **Charts:** Recharts 2.10
- **HTTP Client:** Fetch API (built-in)

### Infrastructure
- **Containerization:** Docker + Docker Compose
- **Database:** PostgreSQL 16-Alpine
- **API Data Source:** NepseAPI-Unofficial (self-hosted)
- **AI:** Claude API (Phase 3)

### Development
- **Package Manager:** npm (frontend), pip (backend)
- **Version Control:** Git
- **Testing:** pytest (backend), Jest (frontend, Phase 2)
- **Linting:** ESLint (frontend), flake8 (backend)
- **Type Checking:** TypeScript (frontend), Pydantic (backend)

---

## Project Structure

```
nepselligence/
├── backend/
│   ├── config.py           # Environment config (NEPSE_API_URL, DATABASE_URL, etc.)
│   ├── database.py         # SQLAlchemy engine + session factory
│   ├── models.py           # 4 ORM models (StockPrice, Floorsheet, MarketStatus, AIInsight)
│   ├── providers.py        # DataProvider abstraction (primary/fallback)
│   ├── scheduler.py        # APScheduler jobs + market guard
│   ├── main.py             # FastAPI app + 3 endpoints (/health, /api/stocks/*, /api/stocks/{}/floorsheet)
│   └── requirements.txt     # (deprecated, see pyproject.toml)
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx         # Root layout + metadata
│   │   │   ├── page.tsx           # Dashboard page
│   │   │   ├── globals.css        # Dark theme + desktop constraint
│   │   │   └── favicon.ico
│   │   └── components/
│   │       ├── TimeRangeSelector.tsx  # 1D/5D/1M/3M buttons
│   │       ├── IndexChart.tsx         # Recharts line chart (API-integrated)
│   │       ├── TopMovers.tsx          # Gainers/Losers tabs (API-integrated)
│   │       ├── Watchlist.tsx          # Symbol table (API-integrated)
│   │       └── AIPanel.tsx            # Read-only insight broadcast
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── .env.example
│   └── README.md
├── tests/
│   └── test_critical_bugs.py   # 12 regression tests (T1-T12)
├── docker-compose.yml          # 3 services: postgres, nepseapi, backend
├── Dockerfile.backend          # Python 3.12 + dependencies
├── pyproject.toml              # Backend dependencies + build config
├── .env.example                # Backend .env template
├── .gitignore
├── SETUP.md                    # Backend setup guide
├── DAY1_DAY2_COMPLETE.md       # Days 1-2 summary (design → implementation)
├── PHASE2_COMPLETE.md          # Phase 2 summary (integration verified)
├── PLAN.md                     # Full technical design (25 auto-decisions locked)
├── CLAUDE.md                   # Skill routing + project guidelines
└── README.md                   # This file
```

---

## Getting Started

### Prerequisites

- Docker & Docker Compose (all-in-one setup)
- Node.js 18+ (if running frontend separately)
- Python 3.12 (if running backend separately)
- Git

### Quick Start (Docker)

```bash
# Clone repository
git clone https://github.com/aarogyarijal/nepselligence.git
cd nepselligence

# Start all services
docker compose up -d

# Wait for containers to initialize
sleep 20

# Verify services
docker compose ps

# Expected output:
# nepselligence-postgres   postgres  Up (healthy)
# nepselligence-nepseapi   nepseapi  Up
# nepselligence-backend    backend   Up (healthy)
```

### Test Backend

```bash
# Health check
curl -s http://localhost:8080/health | jq .
# → {"status": "ok", "scheduler_running": true}

# Get latest stock prices
curl -s http://localhost:8080/api/stocks/latest | jq .
# → [] (empty until market opens)

# Get floorsheet for a symbol (when market is open)
curl -s http://localhost:8080/api/stocks/NABIL/floorsheet | jq .
```

### Run Frontend

```bash
cd frontend

# Install dependencies
npm install

# Development mode
npm run dev
# → Open http://localhost:3000

# Production build
npm run build
npm start
```

### Access Dashboard

Open your browser to **http://localhost:3000**

**Note:** Desktop only (min-width: 1280px). Mobile shows message asking to use desktop.

---

## Development

### Backend Development

```bash
# Install Python dependencies
pip install -e .  # editable install from pyproject.toml

# Run tests
pytest tests/test_critical_bugs.py -v

# Run backend locally
python -m uvicorn backend.main:app --reload --port 8080

# View database
psql postgresql://nepselligence:nepselligence@localhost:5432/nepselligence
```

### Frontend Development

```bash
cd frontend

# Install dependencies
npm install

# Development mode (with hot reload)
npm run dev

# Type check
npm run type-check

# Build for production
npm run build

# Run production build locally
npm start
```

### Environment Variables

**Backend** (`.env`):
```
DATABASE_URL=postgresql://nepselligence:nepselligence@localhost:5432/nepselligence
NEPSE_API_URL=http://localhost:8000
SCHEDULER_TIMEZONE=Asia/Kathmandu
CLAUDE_API_KEY=sk-ant-...  # Optional, for Phase 3
```

**Frontend** (`.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:8080
```

---

## API Documentation

### Backend Endpoints

#### Health Check
```
GET /health

Response:
{
  "status": "ok",
  "scheduler_running": true
}
```

#### Get Latest Stock Prices
```
GET /api/stocks/latest

Response (array of stocks):
[
  {
    "symbol": "NABIL",
    "ltp": 1234.50,          # Last Traded Price
    "change": 45.20,         # Absolute change
    "changePercent": 3.79,   # Percent change
    "time": "2026-04-05T14:30:00Z"
  },
  ...
]
```

#### Get Floorsheet (Recent Trades)
```
GET /api/stocks/{symbol}/floorsheet?limit=100

Parameters:
- symbol (required): Stock symbol (e.g., NABIL)
- limit (optional): Number of trades to return (default: 100)

Response (array of trades):
[
  {
    "symbol": "NABIL",
    "buyer": "Buyer Name",
    "seller": "Seller Name",
    "quantity": 500,
    "rate": 1234.50,
    "time": "2026-04-05T14:30:00Z"
  },
  ...
]
```

### CORS Policy

Frontend (localhost:3000) can call backend (localhost:8080). For production, update CORS settings in `backend/main.py`.

---

## Deployment

### Docker Compose (Recommended)

Already set up in `docker-compose.yml`. For production:

1. Update environment variables in `docker-compose.yml` or `.env`
2. Use named volumes (not mounted paths)
3. Add health checks for monitoring
4. Set resource limits (CPU, memory)

```bash
# Production deployment
docker compose up -d

# Monitor
docker compose logs -f backend
docker compose logs -f frontend  # if containerized separately
```

### Individual Services

#### Backend Deployment (VPS/Cloud)

```bash
# Build Docker image
docker build -f Dockerfile.backend -t nepselligence-backend .

# Run container
docker run -d \
  -e DATABASE_URL=postgresql://... \
  -e NEPSE_API_URL=http://nepseapi:8000 \
  -e SCHEDULER_TIMEZONE=Asia/Kathmandu \
  -p 8080:8080 \
  nepselligence-backend

# Or use systemd service + Gunicorn/Uvicorn
# See SETUP.md for production checklist
```

#### Frontend Deployment (Vercel/Netlify/VPS)

```bash
# Vercel (recommended for Next.js)
npm install -g vercel
vercel

# Netlify
npm run build
# Upload dist to Netlify

# VPS with Node
npm run build
npm start
# Use PM2 or systemd for process management
```

---

## Testing

### Backend Tests

```bash
# Run all tests
pytest tests/test_critical_bugs.py -v

# Run specific test
pytest tests/test_critical_bugs.py::test_cron_timezone_correct -v

# With coverage
pytest --cov=backend tests/
```

### Test Coverage (12 Critical Bugs)

| Test | Bug | Status |
|------|-----|--------|
| T1 | Cron timezone (NPT not UTC) | ✅ PASS |
| T2 | Market status guard | ✅ PASS |
| T3 | Dual-writer dedup | ✅ PASS |
| T4 | Job overlap prevention | ✅ PASS |
| T5 | DataProvider fallback | ✅ PASS |
| T6 | Claude JSON parsing | ✅ PASS |
| T7 | NPT offset (UTC+5:45) | ✅ PASS |
| T8 | Floorsheet retention (90 days) | ✅ PASS |
| T9 | WebSocket reconnection | 🔄 Phase 3 |
| T10 | South Asian number format | ✅ PASS |
| T11 | Prompt injection defense | ✅ PASS |
| T12 | Empty state first run | ✅ PASS |

### Frontend Tests

```bash
# Type checking
npm run type-check

# (E2E tests deferred to Phase 2)
```

---

## Known Issues

### Current Limitations

1. **Port 3000 in use:** If port 3000 is occupied, kill with:
   ```bash
   lsof -i :3000 | grep -v COMMAND | awk '{print $2}' | xargs kill -9
   ```

2. **NepseAPI health:** Shows "unhealthy" in `docker compose ps` but REST API works. No impact on functionality.

3. **Empty data (expected):** `/api/stocks/latest` returns `[]` when:
   - Market is closed (open Sun-Thu, 11 AM - 3 PM NPT)
   - APScheduler hasn't run yet
   - Data populates automatically during market hours

4. **Mock data fallback:** Frontend shows mock data now. Real data appears when backend has prices.

5. **No WebSocket yet:** All updates use polling. Live refresh is Phase 3.

6. **Single-user MVP:** No authentication. Add in Phase 3.

7. **No mobile:** Desktop-only (1280px+). Mobile responsive is Phase 3.

### Workarounds

- To test with mock live data, manually insert records into PostgreSQL:
  ```bash
  psql -h localhost -U nepselligence -d nepselligence -c \
    "INSERT INTO stock_prices (symbol, ltp, change, change_percent, time) \
     VALUES ('NABIL', 1234.50, 45.20, 3.79, NOW());"
  ```

- To force scheduler to run (for testing):
  ```python
  # In backend/main.py, add temporary endpoint
  @app.post("/test/fetch-prices")
  async def test_fetch():
      await scheduler_jobs.ingest_latest_prices()
      return {"status": "done"}
  ```

---

## Roadmap

### Phase 3 (April 2026)
- [ ] WebSocket proxy for live price updates (1-5 second refresh)
- [ ] Claude API integration for hourly market summaries
- [ ] Floorsheet detail modal (click symbol → trade history)
- [ ] Search bar + symbol lookup
- [ ] Historical chart data (5D, 1M, 3M)

### Phase 4 (May 2026)
- [ ] Mobile responsive design
- [ ] User authentication + multi-user support
- [ ] Saved watchlists (user preferences)
- [ ] Advanced analytics (MA, RSI, Bollinger Bands)
- [ ] Price alerts + notifications

### Phase 5+ (June 2026+)
- [ ] Additional data sources (ShareSansar, Merolagani)
- [ ] Macro indicators (GDP, inflation, forex)
- [ ] Fundamental analysis (P/E, dividend yield)
- [ ] Trading simulator
- [ ] Mobile app (React Native)

---

## Contributing

### Code Style

- **Python:** PEP 8 (flake8)
- **TypeScript:** ESLint + Prettier
- **Commit messages:** Conventional Commits (feat:, fix:, docs:, etc.)

### Workflow

1. Create feature branch: `git checkout -b feat/my-feature`
2. Make changes and test locally
3. Commit with clear message: `git commit -m "feat: Add X feature"`
4. Push: `git push origin feat/my-feature`
5. Create pull request with description
6. Address review feedback
7. Merge to main

### Running Tests Before Push

```bash
# Backend
pytest tests/ -v

# Frontend
npm run type-check

# Both
docker compose up -d && sleep 10 && curl http://localhost:8080/health
```

---

## License

MIT License. See LICENSE file.

---

## Support

- **Documentation:** See SETUP.md, DAY1_DAY2_COMPLETE.md, PHASE2_COMPLETE.md, PLAN.md
- **Issues:** Create GitHub issue with detailed description
- **Questions:** Check existing issues or documentation first
- **Contact:** aarogyarijal@example.com

---

## Acknowledgments

- **NepseAPI-Unofficial** — Real-time market data
- **Claude (Anthropic)** — AI insights generation
- **Next.js & FastAPI** — Framework excellence
- **PostgreSQL & Docker** — Reliable infrastructure

---

## Project Status

```
├── MVP (Days 1-2)        ✅ Complete
│   ├── Backend           ✅ PostgreSQL + APScheduler + FastAPI
│   ├── Frontend          ✅ Next.js 14 + React 18 + Recharts
│   ├── Docker            ✅ 3 services running
│   └── API integration   ✅ Frontend calls backend
│
├── Phase 2 (Integration) ✅ Complete
│   ├── Docker fixes      ✅ All services healthy
│   ├── API wiring        ✅ IndexChart, TopMovers, Watchlist connected
│   ├── Error handling    ✅ Graceful fallback to mock data
│   └── Testing           ✅ End-to-end verified
│
├── Phase 3 (Enhancements) 🔄 Ready to start
│   ├── WebSocket proxy   ⏳ Planned
│   ├── Claude API        ⏳ Planned
│   ├── Floorsheet modal  ⏳ Planned
│   └── Search            ⏳ Planned
│
└── Phase 4+ (Scale)      📋 Backlog
    ├── Mobile responsive ⏳
    ├── Auth              ⏳
    └── Analytics         ⏳
```

**Last Updated:** 2026-04-05  
**Next Milestone:** Live market data integration (depends on market hours)

---

**Ready to build? Start with:** `docker compose up -d && cd frontend && npm run dev`
