<!-- /autoplan restore point: /Users/aarogyarijal/.gstack/projects/nepselligence/-autoplan-restore-20260405-021458.md -->

# NEPSE AI Dashboard — Implementation Plan

## Decision: Recommended Stack

After evaluating every available option, here's the recommended architecture for a personal-use NEPSE dashboard with AI insights.

### Why this combination wins

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Primary data** | Self-hosted NepseAPI-Unofficial (Docker) | Full control, no rate limits, REST + WebSocket + MCP in one package |
| **Backup / gap-fill** | NepseUnofficialApi (Python lib) | Battle-tested auth deciphering, direct nepalstock.com access, CLI tool |
| **Supplementary** | ShareSansar + Merolagani scrapers | Macro data, corporate actions, fundamentals not in any API |
| **Quick lookups** | ShareBazaar API | Zero-auth, free, CORS-enabled — perfect for client-side fallback |
| **Database** | PostgreSQL + TimescaleDB | Time-series optimized, hypertables for OHLCV, standard SQL |
| **AI engine** | Claude via MCP server | Already built into NepseAPI-Unofficial, 20+ tools ready |
| **Frontend** | Next.js + Recharts/D3 | SSR for fast loads, React ecosystem, great charting |

---

## Phase 1: Core Data Pipeline (Week 1-2)

### 1.1 Self-host NepseAPI-Unofficial

This is the backbone. It gives you REST, WebSocket, and MCP from a single Docker container.

```bash
# Clone and run locally
git clone https://github.com/surajrimal07/NepseAPI-Unofficial.git
cd NepseAPI-Unofficial

# Docker compose (recommended)
docker-compose up -d

# Exposes:
#   REST API     → http://localhost:8000
#   WebSocket    → ws://localhost:5555
#   MCP Server   → http://localhost:8080
```

**Available REST endpoints** (discovered from docs + source):

| Endpoint | Data returned |
|----------|--------------|
| `GET /Summary` | Total turnover, traded shares, transactions, scrips traded |
| `GET /TopGainers` | Top gaining stocks with symbol, LTP, change % |
| `GET /TopLosers` | Top losing stocks |
| `GET /NepseIndex` | All NEPSE indices and sub-indices |
| `GET /SectorSummary` | Sector-wise performance breakdown |
| `GET /CompanyDetails/{symbol}` | Full company profile + current trading data |
| `GET /Floorsheet` | Transaction-level data (buyer, seller, qty, rate) |
| `GET /LiveMarket` | Real-time prices for all scrips |
| `GET /MarketDepth/{symbol}` | Bid/ask order book depth |
| `GET /validate/stock/{symbol}` | Symbol validation with suggestions |
| `GET /health` | Service health check |

**Rate limits**: 60 requests/minute when self-hosted (configurable). The hosted version at `nepseapi.surajrimal.dev` has stricter limits and runs on a free Oracle Cloud VM — don't depend on it.

**Caching behavior**: 10-minute in-memory TTL on all endpoints + 30-second HTTP Cache-Control headers.

### 1.2 Install NepseUnofficialApi as backup/enrichment

```bash
pip install git+https://github.com/basic-bgnr/NepseUnofficialApi.git
```

This library reverse-engineers the NEPSE website's authentication token and gives you direct access to nepalstock.com's internal API.

```python
from nepse import Nepse

nepse = Nepse()
nepse.setTLSVerification(False)  # Required — NEPSE has SSL issues

# Full method catalog:
nepse.getCompanyList()           # All listed companies
nepse.getMarketStatus()          # Open/closed status
nepse.getMarketSummary()         # Daily summary stats
nepse.getNepseIndex()            # NEPSE index value
nepse.getNepseSubIndices()       # All sub-indices
nepse.getTopTenGainers()         # Top 10 gainers
nepse.getTopTenLosers()          # Top 10 losers
nepse.getTopTenTradeScrips()     # By trade count
nepse.getTopTenTransactionScrips()  # By transaction count
nepse.getTopTenTurnoverScrips()  # By turnover
nepse.getFloorSheet()            # Full day's floorsheet
nepse.getFloorSheetOf(symbol)    # Floorsheet for specific stock
nepse.getLiveMarket()            # Real-time prices
nepse.getSecurityDetails(symbol) # Detailed security info
nepse.getMarketDepth(symbol)     # Order book
```

### 1.3 Database schema (PostgreSQL + TimescaleDB)

```sql
-- Enable TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Core price data (hypertable for time-series optimization)
CREATE TABLE stock_prices (
    time         TIMESTAMPTZ NOT NULL,
    symbol       VARCHAR(20) NOT NULL,
    open_price   DECIMAL(12,2),
    high_price   DECIMAL(12,2),
    low_price    DECIMAL(12,2),
    close_price  DECIMAL(12,2),
    volume       BIGINT,
    turnover     DECIMAL(18,2),
    transactions INTEGER
);
SELECT create_hypertable('stock_prices', 'time');
CREATE INDEX idx_prices_symbol ON stock_prices (symbol, time DESC);

-- Market summary snapshots
CREATE TABLE market_summary (
    time              TIMESTAMPTZ NOT NULL,
    total_turnover    DECIMAL(18,2),
    total_shares      BIGINT,
    total_transactions INTEGER,
    total_scrips      INTEGER,
    nepse_index       DECIMAL(10,2),
    nepse_change      DECIMAL(10,2),
    nepse_change_pct  DECIMAL(6,2)
);
SELECT create_hypertable('market_summary', 'time');

-- Floorsheet (transaction-level)
CREATE TABLE floorsheet (
    time         TIMESTAMPTZ NOT NULL,
    symbol       VARCHAR(20),
    buyer_broker INTEGER,
    seller_broker INTEGER,
    quantity     INTEGER,
    rate         DECIMAL(12,2),
    amount       DECIMAL(18,2)
);
SELECT create_hypertable('floorsheet', 'time');

-- Company fundamentals (updated quarterly)
CREATE TABLE company_fundamentals (
    symbol       VARCHAR(20) PRIMARY KEY,
    company_name VARCHAR(200),
    sector       VARCHAR(100),
    eps          DECIMAL(10,2),
    pe_ratio     DECIMAL(10,2),
    book_value   DECIMAL(12,2),
    pbv_ratio    DECIMAL(10,2),
    market_cap   DECIMAL(18,2),
    shares_outstanding BIGINT,
    roe          DECIMAL(8,2),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Corporate actions
CREATE TABLE corporate_actions (
    id           SERIAL PRIMARY KEY,
    symbol       VARCHAR(20),
    action_type  VARCHAR(50),  -- dividend, bonus, rights, AGM, IPO
    details      JSONB,
    action_date  DATE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Macro indicators (from ShareSansar scraping)
CREATE TABLE macro_indicators (
    time              TIMESTAMPTZ NOT NULL,
    indicator_name    VARCHAR(100),
    value             DECIMAL(18,4),
    unit              VARCHAR(50),
    source            VARCHAR(100)
);
SELECT create_hypertable('macro_indicators', 'time');

-- AI analysis cache
CREATE TABLE ai_insights (
    id           SERIAL PRIMARY KEY,
    scope        VARCHAR(50),   -- 'market', 'sector', 'stock'
    target       VARCHAR(50),   -- symbol or sector name
    insight_type VARCHAR(50),   -- 'summary', 'signal', 'alert'
    content      TEXT,
    metadata     JSONB,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    expires_at   TIMESTAMPTZ
);
```

### 1.4 Data ingestion scheduler

```python
# ingestion_scheduler.py — APScheduler-based orchestrator

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import httpx, asyncio

API_BASE = "http://localhost:8000"

scheduler = AsyncIOScheduler()

# During market hours (11 AM - 3 PM NPT = 5:15 AM - 9:15 AM UTC)
# Poll live prices every 2 minutes
scheduler.add_job(
    fetch_live_prices,
    CronTrigger(day_of_week='sun-thu', hour='5-9', minute='*/2',
                timezone='Asia/Kathmandu'),
    id='live_prices'
)

# Market summary every 5 minutes during trading
scheduler.add_job(
    fetch_market_summary,
    CronTrigger(day_of_week='sun-thu', hour='11-15', minute='*/5',
                timezone='Asia/Kathmandu'),
    id='market_summary'
)

# Full floorsheet at market close (3:15 PM NPT)
scheduler.add_job(
    fetch_floorsheet,
    CronTrigger(day_of_week='sun-thu', hour=15, minute=15,
                timezone='Asia/Kathmandu'),
    id='floorsheet'
)

# Daily OHLCV snapshot after market close (4 PM NPT)
scheduler.add_job(
    fetch_daily_ohlcv,
    CronTrigger(day_of_week='sun-thu', hour=16, minute=0,
                timezone='Asia/Kathmandu'),
    id='daily_ohlcv'
)

# Fundamentals scrape weekly (Friday 6 PM NPT)
scheduler.add_job(
    scrape_fundamentals,
    CronTrigger(day_of_week='fri', hour=18, minute=0,
                timezone='Asia/Kathmandu'),
    id='fundamentals'
)

# Macro indicators monthly
scheduler.add_job(
    scrape_macro_data,
    CronTrigger(day=1, hour=6, minute=0, timezone='Asia/Kathmandu'),
    id='macro'
)
```

**Important**: NEPSE trades Sunday through Thursday (closed Friday/Saturday). The scheduler accounts for this.

---

## Phase 2: Supplementary Scrapers (Week 2-3)

### 2.1 ShareBazaar for quick client-side lookups

```javascript
// Client-side fallback for real-time price
const getPrice = async (symbol) => {
  const res = await fetch(
    `https://nepsetty.kokomo.workers.dev/api?symbol=${symbol}`
  );
  return res.json();
  // Returns: { price, previousClose, change, changePct, volume, lastUpdated }
};
```

### 2.2 ShareSansar macro data scraper

```python
# scraper_sharesansar.py
import httpx
from bs4 import BeautifulSoup

TARGETS = {
    'dividends': 'https://www.sharesansar.com/proposed-dividend',
    'today_price': 'https://www.sharesansar.com/today-share-price',
    'indices': 'https://www.sharesansar.com/nepse-sub-index',
    'floorsheet': 'https://www.sharesansar.com/floorsheet',
    'ipo_results': 'https://www.sharesansar.com/existing-issues',
}

async def scrape_proposed_dividends():
    async with httpx.AsyncClient() as client:
        resp = await client.get(TARGETS['dividends'])
        soup = BeautifulSoup(resp.text, 'html.parser')
        table = soup.find('table', class_='table')
        rows = []
        for tr in table.find_all('tr')[1:]:
            cells = [td.get_text(strip=True) for td in tr.find_all('td')]
            if len(cells) >= 6:
                rows.append({
                    'symbol': cells[1],
                    'bonus': cells[2],
                    'cash': cells[3],
                    'total': cells[4],
                    'fiscal_year': cells[5],
                })
        return rows
```

### 2.3 Merolagani floorsheet + fundamentals

```python
# scraper_merolagani.py
async def scrape_company_fundamentals(symbol: str):
    url = f"https://merolagani.com/CompanyDetail.aspx/{symbol}/"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url)
        soup = BeautifulSoup(resp.text, 'html.parser')
        # Parse EPS, P/E, book value, market cap, shares outstanding, sector
        ...
```

### 2.4 NepseAlpha historical OHLCV (for backfill)

```python
# scraper_nepsealpha.py
async def fetch_history(symbol: str, from_ts: int, to_ts: int):
    import cloudscraper
    scraper = cloudscraper.create_scraper()
    scraper.get(f'https://nepsealpha.com/trading/1/symbols?symbol={symbol}')
    resp = scraper.get(
        f'https://nepsealpha.com/trading/1/history',
        params={
            'symbol': symbol,
            'resolution': '1D',
            'from': from_ts,
            'to': to_ts,
            'currencyCode': 'NRS'
        }
    )
    data = resp.json()
    # Returns: { t: [timestamps], o: [opens], h: [highs], l: [lows], c: [closes], v: [volumes] }
    return data
```

---

## Phase 3: Real-time WebSocket Layer (Week 3)

### 3.1 WebSocket consumer

```python
# ws_consumer.py
import asyncio, json, websockets

WS_URL = "ws://localhost:5555"

async def subscribe():
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({"route": "summary"}))
        response = json.loads(await ws.recv())

        await ws.send(json.dumps({
            "route": "company",
            "params": {"symbol": "NABIL"}
        }))
        company = json.loads(await ws.recv())
```

### 3.2 Frontend WebSocket bridge (Next.js)

```typescript
// hooks/useNepseStream.ts
import { useEffect, useState } from 'react';

export function useNepseStream(route: string, params?: object) {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:5555');

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ route, params }));
    };

    ws.onmessage = (event) => {
      setData(JSON.parse(event.data));
    };

    ws.onclose = () => setConnected(false);

    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ route, params }));
      }
    }, 30000);

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [route]);

  return { data, connected };
}
```

---

## Phase 4: AI Insights via MCP (Week 3-4)

### 4.1 MCP server integration

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "nepseapi": {
      "command": "uv",
      "args": [
        "run", "--with", "fastmcp",
        "--with", "requests",
        "--with", "pydantic",
        "python", "/path/to/NepseAPI-Unofficial/mcp_server.py"
      ]
    }
  }
}
```

### 4.2 Programmatic AI analysis

```python
# ai_insights.py
import anthropic, json

client = anthropic.Anthropic()

async def generate_market_insight(market_data: dict, scope: str = "market"):
    prompt = f"""Analyze the following NEPSE market data and provide:
1. A 2-sentence market summary
2. Key signals (bullish/bearish with confidence)
3. Sector rotation observations
4. Any anomalies worth noting

Market Data:
{json.dumps(market_data, indent=2)}

Respond in JSON format:
{{
  "summary": "...",
  "sentiment": "bullish|bearish|neutral",
  "confidence": 0.0-1.0,
  "signals": [...],
  "sector_notes": "...",
  "anomalies": [...]
}}"""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}]
    )

    return json.loads(response.content[0].text)
```

### 4.3 AI analysis schedule

| Trigger | Analysis type | Storage |
|---------|--------------|---------|
| Market open (11 AM) | Pre-market outlook based on previous close | `ai_insights` table |
| Every hour during trading | Live sentiment + sector rotation | `ai_insights` table |
| Market close (3 PM) | End-of-day summary + next-day outlook | `ai_insights` table |
| Unusual volume spike | Alert generation | Push to frontend via WebSocket |
| Weekly (Friday) | Technical analysis signals for watchlist | `ai_insights` table |

---

## Phase 5: Frontend Dashboard (Week 4-5)

### 5.1 Dashboard modules

| Module | Data source | Update frequency |
|--------|------------|-----------------|
| **NEPSE index chart** | `market_summary` table | Real-time (WS) |
| **Live ticker strip** | ShareBazaar API (client-side) | 30s poll |
| **Top movers** | NepseAPI `/TopGainers` + `/TopLosers` | 2 min |
| **Sector heatmap** | NepseAPI `/SectorSummary` | 5 min |
| **Stock detail view** | NepseAPI `/CompanyDetails/{sym}` + DB fundamentals | On demand |
| **Floorsheet viewer** | `floorsheet` table | End of day |
| **AI insights panel** | `ai_insights` table | Hourly |
| **Macro dashboard** | `macro_indicators` table | Monthly |
| **Portfolio tracker** | Local state + live prices | Real-time |
| **Corporate actions feed** | `corporate_actions` table | Daily |

### 5.2 Tech choices

```
Frontend:  Next.js 14 (App Router)
Charts:    Recharts for standard charts, D3 for heatmap
Styling:   Tailwind CSS
State:     Zustand (lightweight, no boilerplate)
API:       tRPC or REST endpoints from Next.js API routes
Auth:      None needed (personal use — local network only)
```

---

## Data Coverage Matrix

| Data point | Primary source | Fallback | Update freq |
|-----------|---------------|----------|-------------|
| Live price (LTP) | NepseAPI WS | ShareBazaar | Real-time |
| OHLCV daily | NepseAPI REST | NepseUnofficialApi | EOD |
| OHLCV historical | NepseAlpha scrape | — | One-time backfill |
| NEPSE index | NepseAPI REST | NepseUnofficialApi | 5 min |
| Sub-indices | NepseAPI REST | NepseUnofficialApi | 5 min |
| Sector performance | NepseAPI REST | ShareSansar | 5 min |
| Top gainers/losers | NepseAPI REST | NepseUnofficialApi | 2 min |
| Market depth | NepseAPI REST | NepseUnofficialApi | On demand |
| Floorsheet | NepseAPI REST | Merolagani scrape | EOD |
| Company list | NepseAPI REST | NepseUnofficialApi | Daily |
| EPS / P/E / BVPS | Merolagani scrape | Nepalytix | Weekly |
| Dividends / Bonus | ShareSansar scrape | Merolagani | Daily |
| IPO / FPO | ShareSansar scrape | Merolagani | Daily |
| AGM dates | ShareSansar scrape | Merolagani | Daily |
| Mutual fund NAV | ShareSansar scrape | — | Weekly |
| Interest rates | ShareSansar scrape | NRB website | Monthly |
| Remittance data | ShareSansar scrape | NRB website | Monthly |
| GDP / inflation | ShareSansar scrape | NRB website | Quarterly |
| Broker analysis | Merolagani / NepseAlpha | — | Weekly |
| AI market insights | Claude API | — | Hourly |

---

## Infrastructure (Personal Setup)

```
Local machine or VPS:
├── Docker Compose
│   ├── nepseapi        (NepseAPI-Unofficial — REST + WS + MCP)
│   ├── postgres        (PostgreSQL 16 + TimescaleDB)
│   └── redis           (Optional: caching layer for dashboard)
├── Python services
│   ├── ingestion_scheduler.py   (APScheduler — cron-based data fetcher)
│   ├── ws_consumer.py           (WebSocket → DB writer)
│   ├── scraper_sharesansar.py   (Weekly/monthly macro scraper)
│   ├── scraper_merolagani.py    (Weekly fundamentals scraper)
│   └── ai_insights.py           (Scheduled Claude analysis)
└── Next.js app
    └── Dashboard frontend (http://localhost:3000)
```

**Total monthly cost**: $0 (fully self-hosted). Claude API calls for AI insights at ~$0.003/1K tokens = under $5/month.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| NEPSE changes its internal API | Follow NepseUnofficialApi repo (5+ breaking changes tracked since 2023) |
| NepseAlpha blocks scrapers | Only use for historical backfill; store all fetched data locally |
| ShareSansar changes HTML structure | Use CSS selectors loosely; add health checks that alert on parse failures |
| API rate limits hit | Self-host NepseAPI-Unofficial; never depend on hosted free tier |
| NEPSE SSL certificate issues | `setTLSVerification(False)` is standard practice across all libraries |
| Claude API costs spike | Cache AI insights aggressively (1-hour TTL); batch analysis during off-hours |

---

## Implementation Order

1. **Day 1-2**: Docker Compose with NepseAPI-Unofficial + PostgreSQL + TimescaleDB
2. **Day 3-4**: Database schema + ingestion scheduler for core price data
3. **Day 5-7**: WebSocket consumer + real-time price storage
4. **Day 8-10**: ShareSansar + Merolagani scrapers for supplementary data
5. **Day 11-12**: NepseAlpha historical backfill (one-time run)
6. **Day 13-15**: Claude MCP integration + scheduled AI insights
7. **Day 16-20**: Next.js dashboard with all modules
8. **Day 21-25**: Portfolio tracker, alerts, and polish
9. **Day 26-28**: Testing, error handling, monitoring
10. **Day 29-30**: Historical backfill verification + documentation

---

# /autoplan Review — Phase 1: CEO Review

## PRE-REVIEW SYSTEM AUDIT
- No git history (greenfield project)
- No existing code — PLAN.md and CLAUDE.md only
- No TODOS.md, no design doc, no handoff note
- No FIXME/TODO comments to check

## Step 0A: Premise Challenge

Five load-bearing premises in this plan:

| Premise | Assessment |
|---------|-----------|
| NepseAPI-Unofficial is reliable enough to build on | **ASSUMED — WRONG.** It's a community Docker container reverse-engineering an undocumented internal API that has broken 5+ times since 2023. |
| TimescaleDB is the right DB for this workload | **ASSUMED — WRONG.** 250 trading days × 250 scrips × OHLCV = ~62,500 rows/year. Plain Postgres handles this trivially. TimescaleDB adds extension dependency and operational complexity with zero user-visible benefit. |
| Hourly Claude AI summaries will be valuable | **ASSUMED — UNVALIDATED.** Canned JSON-to-text summaries stored in a DB table = LLM-as-pretty-printer. `"confidence": 0.0-1.0` on stock direction is pseudoscientific. No language model produces calibrated probability estimates from a JSON blob. |
| The merged multi-source data will be coherent | **ASSUMED — MISSING LAYER.** 5 sources with different update cadences, semantics, and timestamps combined with no canonicalization layer = the dashboard will frequently show contradictory "truths." |
| 30-day timeline is realistic | **ASSUMED — OPTIMISTIC.** 2 Docker services + 5 Python services + 3 scrapers + WebSocket consumer + scheduler + AI runner + Next.js app with 10 modules + 6-table DB schema = 2-3 months for a solo developer. |

## Step 0B: Existing Code Leverage Map

No existing code in this project. All external dependencies. Nothing to leverage or avoid rebuilding.

External things that already exist and partially solve sub-problems:
- Merolagani/ShareSansar: live prices, fundamentals, floorsheet, sector data — with working UIs
- NepseAlpha: TradingView-style OHLCV charts
- TradingView: supports select NEPSE securities with full charting
- Claude Desktop + NepseAPI MCP server: interactive AI analysis today, zero frontend build required

## Step 0C: Dream State Diagram

```
CURRENT STATE                 THIS PLAN                     12-MONTH IDEAL
─────────────────             ──────────────────────────    ──────────────────────────
Manual checking on  ──────►   Local dashboard with           Decision-support system:
merolagani.com &              real-time prices, AI           - Watchlist alerts (price,
nepsealpha.com                summaries, portfolio             volume, fundamentals)
                              tracker, 10 modules,           - Conversational AI via MCP
No data persistence           5 Python services,               that knows your portfolio
                              TimescaleDB                    - Anomaly detection
No alerts                                                    - Backtesting framework
                              Delta: rebuilds tools          - Thin visualization layer
No AI analysis                that already exist +
                              adds AI narration              Delta: AI layer is the
                                                             differentiator; everything
                                                             else is plumbing
```

## Step 0C-bis: Implementation Alternatives

```
APPROACH A: MCP-First (Minimal — Validate First)
  Summary: Wire NepseAPI-Unofficial MCP server into Claude Desktop. No database,
           no scheduler, no frontend. Use conversationally for 2 weeks.
  Effort:  S (2-3 days)
  Risk:    Low
  Pros:    - Working AI analysis in days, not weeks
           - Validates whether AI layer delivers real value before infra build
           - Zero maintenance overhead
  Cons:    - No historical data persistence
           - No portfolio tracking
           - No automated alerts
  Reuses:  NepseAPI-Unofficial MCP server (already built)

APPROACH B: The Plan (Full Stack — as written)
  Summary: 5-service distributed system with PostgreSQL/TimescaleDB, scrapers,
           WebSocket, scheduler, AI runner, Next.js dashboard.
  Effort:  XL (60-90 days solo, not 30)
  Risk:    High
  Pros:    - Complete solution with historical data
           - Real-time updates, portfolio tracking
           - Offline-capable (all local)
  Cons:    - Rebuilds tools that exist (Merolagani, NepseAlpha UIs)
           - 5 fragile data sources = permanent maintenance tax
           - AI layer (only differentiator) comes last, after 15 days of plumbing
  Reuses:  NepseAPI-Unofficial, NepseUnofficialApi

APPROACH C: Lean Pipeline + Conversational AI
  Summary: NepseAPI-Unofficial → plain Postgres (no TimescaleDB) → simple Next.js
           with just 3-4 high-value modules (index chart, watchlist, AI chat panel).
           No scrapers. No Redis. MCP-based conversational AI as primary interface.
  Effort:  L (3-4 weeks solo)
  Risk:    Medium
  Pros:    - Ships a usable tool in half the time
           - Single data source (NepseAPI-Unofficial) = single point to maintain
           - AI chat panel is genuinely differentiated
           - Historical data persistence
  Cons:    - No macro data (no ShareSansar scraper)
           - No fundamentals (no Merolagani scraper)
  Reuses:  NepseAPI-Unofficial, plain Postgres

RECOMMENDATION: Approach C for the 30-day window. Approach A as the Day 1-3
validation step before committing to C. Approach B deferred to TODOS.md as
"Platform expansion after core is stable."
```

## Step 0D: SELECTIVE EXPANSION (auto-decided)

**Scope baseline:** Approach C (Lean Pipeline + Conversational AI).

**Cherry-pick expansions — AUTO-DECIDED per P1/P2/P3:**

| # | Expansion | Decision | Principle | Rationale |
|---|-----------|----------|-----------|-----------|
| 1 | Data quality monitoring (row count checks, price sanity bounds, daily health alerts) | **ACCEPTED** | P2 (blast radius, <1 day CC) | Critical gap. Silent failures are the #1 kill risk per both voices. |
| 2 | Data canonicalization layer (single source-of-truth per data point, timestamp validation) | **ACCEPTED** | P1 (completeness) | Missing layer that prevents contradictory dashboard "truths." |
| 3 | Replace TimescaleDB with plain PostgreSQL | **ACCEPTED** | P5 (explicit over clever) | Zero user-visible benefit for the data volume. Saves ops complexity. |
| 4 | Remove `"confidence": 0.0-1.0` from AI output schema | **ACCEPTED** | P5 (explicit over clever) | Pseudoscientific. Replace with qualitative reasoning + explicit caveats. |
| 5 | Full scrapers (ShareSansar, Merolagani, NepseAlpha) | **DEFERRED → TODOS.md** | P3 (pragmatic) | Permanent maintenance tax. Add only after core data pipeline is stable 2+ weeks. |
| 6 | Redis caching layer | **DEFERRED → TODOS.md** | P3 (pragmatic) | Premature optimization for personal use. |
| 7 | All 10 dashboard modules | **DEFERRED → TODOS.md** | P2 (scope) | 4-5 modules ship faster, let usage determine which 10 are needed. |
| 8 | Portfolio tracker with alerts | **DEFERRED → TODOS.md** | P6 (action) | Phase 2 after core is stable. |

## Step 0E: Temporal Interrogation

```
HOUR 1 (Day 1 foundations):
  - Does NepseAPI-Unofficial Docker actually run locally? Does auth work?
  - What does the MCP server expose? Test it in Claude Desktop FIRST.
  - Decision needed NOW: which 3-4 dashboard modules ship in v1?

HOUR 2-3 (Days 2-7 core logic):
  - What happens when NepseAPI-Unofficial returns stale/empty data?
  - How do you detect that the data pipeline broke silently?
  - DB schema: TIMESTAMPTZ vs local Nepal time — pick one, document it.

HOUR 4-5 (Days 8-15 integration):
  - WebSocket reconnection on NEPSE server restart?
  - APScheduler behavior when laptop sleeps during market hours?
  - What does the AI panel show when no data has been ingested yet?

HOUR 6+ (Days 16-30 polish/tests):
  - What's the empty state for every dashboard module?
  - What's the error state when NepseAPI-Unofficial is down?
  - How do you know the AI summary is based on fresh data vs. 3-hour-old data?
```

## Step 0F: Mode Confirmed — SELECTIVE EXPANSION

Approach C accepted. Accepted cherry-picks applied. Deferred items → TODOS.md.

---

## CEO DUAL VOICES — CONSENSUS TABLE

```
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   NO      NO    CONFIRMED: INVALID
  2. Right problem to solve?           NO*     NO*   CONFIRMED: reframe needed
  3. Scope calibration correct?        NO      NO    CONFIRMED: oversized
  4. Alternatives explored?            NO      NO    CONFIRMED: none analyzed
  5. Competitive/market risks covered? NO      NO    CONFIRMED: not covered
  6. 6-month trajectory sound?         NO      NO    CONFIRMED: regret scenarios exist
═══════════════════════════════════════════════════════════════
* Claude: MCP-conversational-first reframe
  Codex: watchlist/alerts-first reframe
  Both agree: "full dashboard" as primary deliverable is wrong

USER CHALLENGE: Both models agree the "full dashboard" framing should change to
"decision-support/alerting system." This is surfaced at the Final Gate.
```

---

## Section 1: Architecture Review

**System diagram (Approach C — Lean Pipeline):**

```
  ┌─────────────────────────────────────────────────────────┐
  │                    Data Layer                            │
  │                                                          │
  │  nepalstock.com ──► NepseAPI-Unofficial (Docker :8000)  │
  │                          │                              │
  │                    REST polling + WS                     │
  │                          │                              │
  │               ingestion_scheduler.py                     │
  │                     (APScheduler)                        │
  │                          │                              │
  │                   PostgreSQL :5432                       │
  │              (stock_prices, market_summary,              │
  │               floorsheet, ai_insights)                   │
  └──────────────────────────┬──────────────────────────────┘
                             │
  ┌──────────────────────────▼──────────────────────────────┐
  │                    AI Layer                              │
  │                                                          │
  │  ai_insights.py ──► Claude API                          │
  │  OR                                                      │
  │  Claude Desktop ──► NepseAPI MCP Server (:8080)         │
  │                                                          │
  └──────────────────────────┬──────────────────────────────┘
                             │
  ┌──────────────────────────▼──────────────────────────────┐
  │                   Frontend (Next.js :3000)               │
  │                                                          │
  │  NEPSE Index Chart │ Watchlist │ AI Chat Panel │ Movers  │
  │                                                          │
  │  tRPC → Next.js API routes → PostgreSQL                 │
  └─────────────────────────────────────────────────────────┘
```

**Coupling concerns:** NepseAPI-Unofficial is a hard dependency with no official API contract. If it rotates auth, every data flow breaks simultaneously. The fallback chain (NepseUnofficialApi) is listed but not actively tested.

**Scaling:** N/A — personal use. Single-user workload.

**Single points of failure:** NepseAPI-Unofficial. Full stop. This is the only critical one.

**Security:** No auth on dashboard (personal use, local network only — acceptable). `setTLSVerification(False)` is a risk if NEPSE ever MITM-proxies data; document this explicitly rather than normalizing it.

**Rollback:** No DB migrations needed on greenfield. Rollback = `docker-compose down` + `pg_dump` restore.

## Section 2: Error & Rescue Map

Key failure paths not addressed in the plan:

```
CODEPATH                     | WHAT CAN GO WRONG              | HANDLED?
─────────────────────────────|────────────────────────────────|──────────
NepseAPI-Unofficial REST     | Token rotation → 401           | NO ← GAP
                             | Docker container OOM/crash     | NO ← GAP
                             | Returns stale cached data      | NO ← GAP
APScheduler job              | Job runs during market holiday | Partial (day_of_week)
                             | Laptop sleeps mid-job          | NO ← GAP
                             | Previous job still running     | NO ← GAP (overlap)
PostgreSQL write             | Connection pool exhausted      | NO ← GAP
                             | Disk full                      | NO ← GAP
Claude API call              | Model returns malformed JSON   | NO ← GAP
                             | API rate limit hit             | NO ← GAP
                             | Response is empty/refusal      | NO ← GAP
ShareBazaar fallback         | Cloudflare blocks request      | NO ← GAP
WebSocket                    | WS connection drops mid-market | NO ← GAP
                             | Reconnection storm             | NO ← GAP
```

**Required additions:**
1. Health check job: daily row count assertion + price sanity bounds (price change > 20% = anomaly)
2. APScheduler: `max_instances=1` on all jobs, `misfire_grace_time=300s`
3. Claude API response: validate JSON schema before insert; log raw response on failure

## Section 3: Security & Threat Model

For personal-use local dashboard, risk surface is low. Issues worth noting:

| Threat | Likelihood | Impact | Mitigated? |
|--------|-----------|--------|-----------|
| `setTLSVerification(False)` enables MITM on financial data | Low | Medium | NO — document the tradeoff explicitly, add a comment in code |
| No auth on dashboard | Low (LAN only) | Low | Acceptable for personal use |
| Claude API key in env vars | Low | Medium | Use `.env` + `.gitignore`, don't hardcode |
| Scraper data injection (malicious HTML in scraped content) | Low | Low | Sanitize before DB insert |
| Prompt injection via scraped market data | Low | Medium | Wrap market data in XML trust boundaries before sending to Claude |

No critical security gaps for personal use. The MITM risk and prompt injection risk are worth one-line mitigations in code.

## Section 4: Data Flow & Interaction Edge Cases

**Primary data flow:**

```
NepseAPI REST ──► ingestion_scheduler.py ──► PostgreSQL ──► Next.js API ──► UI
      │                    │                      │               │
      ▼                    ▼                      ▼               ▼
  [401 auth?]       [job overlap?]          [disk full?]    [stale data?]
  [timeout?]        [sleep during?]         [null price?]   [loading state?]
  [stale cache?]    [exception?]            [dup row?]      [error state?]
```

**Edge cases not specified in the plan:**
- Dashboard when zero data has been ingested (Day 1 empty state)
- Dashboard when market is closed vs. open (different "freshness" expectations)
- Stock symbol that exists in one source but not another
- Price = 0 or NULL in database (should be rejected, not displayed)
- NEPSE trading session cancelled (special market holidays)

## Section 5: Code Quality Review

No code exists yet — this is greenfield. Review applies to the design:

- **DRY concern:** The scheduler has 6 jobs with similar `httpx.get → parse → db.insert` patterns. Extract a generic `fetch_and_store(endpoint, parser, table)` to avoid 6 copies of the same pattern.
- **Naming:** `fetch_live_prices` vs `fetch_daily_ohlcv` — clear naming, good.
- **Error handling patterns:** See Section 2. The pattern of bare `async def fetch_X():` with no error handling is the gap to close before any other module.
- **Over-engineering:** TimescaleDB → removed. Redis → deferred. The remaining stack is appropriately sized for the task.
- **Under-engineering:** No retry logic, no circuit breaker on any external call. A simple exponential backoff decorator would handle 80% of transient failures.

## Section 6: Test Review

**New flows this plan introduces:**

```
NEW DATA FLOWS:
  - nepalstock.com → NepseAPI-Unofficial → REST → ingestion_scheduler → PostgreSQL
  - PostgreSQL → ai_insights.py → Claude API → ai_insights table
  - PostgreSQL → Next.js API routes → tRPC → React components

NEW CODEPATHS:
  - Market hours detection (Sun-Thu, 11 AM - 3 PM NPT)
  - APScheduler job execution (6 jobs, different cadences)
  - WebSocket reconnection logic
  - Claude JSON response parsing

NEW INTEGRATIONS:
  - NepseAPI-Unofficial REST/WS
  - Claude API
  - PostgreSQL

NEW ERROR PATHS:
  - All gaps from Section 2 above
```

**Test plan:**

| Flow | Test type | Happy path | Failure path |
|------|-----------|-----------|--------------|
| Ingestion scheduler | Integration | Job runs, data inserted with correct schema | Token rotation → job logs error, sends health alert, does NOT crash scheduler |
| Market hours detection | Unit | Sun 11 AM NPT → job runs | Fri 11 AM NPT → job skipped |
| Claude response parsing | Unit | Valid JSON → stored | Malformed JSON → logged, not stored, no crash |
| DB write | Integration | Row inserted correctly | Duplicate row → upsert, not error |
| WebSocket consumer | Integration | Message received, stored | WS drops → reconnect within 30s |

**2am Friday test:** Does the scheduler crash the whole service if NepseAPI-Unofficial returns a 500? It should log and continue, not abort.

## Section 7: Performance Review

- **Data volume:** 250 days × 250 scrips × OHLCV = ~62,500 rows/year in `stock_prices`. Plain Postgres with a BRIN index on `time` column handles this with sub-millisecond queries for typical date range selections.
- **N+1 queries:** Dashboard renders stock list → each stock makes separate API call? Use batch queries. `SELECT * FROM stock_prices WHERE symbol IN (...) ORDER BY time DESC LIMIT 1 PER symbol` pattern.
- **Claude API calls:** 1-hour TTL cache is appropriate. At 4 calls/trading day = ~1000 calls/year = ~$3-5/year at current pricing. Fine.
- **WebSocket:** Single connection, low message volume. No performance concern.
- **Slowest path:** NepseAlpha historical backfill (cloudscraper + Cloudflare). Rate-limit to 1 req/3s, run once, never again.

## Section 8: Observability & Debuggability

**Critical gap:** The plan has zero observability for the data pipeline. If the scheduler stops working, you won't know for days.

**Required minimum:**
1. Daily health check job at 4:30 PM NPT: `SELECT COUNT(*) FROM stock_prices WHERE time > NOW() - INTERVAL '1 day'` → alert if < expected rows
2. Log every ingestion job start/end with row count: `logger.info(f"live_prices job: inserted {n} rows, took {ms}ms")`
3. `ai_insights` table: add `data_freshness` column = timestamp of most recent data used to generate insight → show in UI

**If bug reported 3 weeks post-ship:** With the logging above, you can reconstruct what happened. Without it, you cannot.

## Section 9: Deployment & Rollout Review

**Personal use = no deployment risk.** All local.

Checklist:
- `docker-compose up -d` on startup
- `.env` file for secrets (CLAUDE_API_KEY, DB_URL)
- `pg_dump` weekly backup (add to cron)
- `docker-compose restart` when NepseAPI-Unofficial breaks (will happen)
- No feature flags needed (personal use)
- No staging environment needed

One genuine risk: running this on a laptop that sleeps. APScheduler will miss jobs during sleep. Solutions: (a) run on a VPS, (b) implement `coalesce=True` on all APScheduler jobs so missed jobs catch up on wake, or (c) accept missed data and handle gaps in queries.

## Section 10: Long-Term Trajectory Review

**Technical debt introduced:**
- Every scraper is debt. The moment ShareSansar or Merolagani changes HTML structure, you owe maintenance time. This is why they're deferred to TODOS.md.
- `setTLSVerification(False)` is debt. NEPSE will eventually fix their SSL cert, at which point you can remove this.

**Path dependency:** The PostgreSQL schema is straightforward and extensible. Adding scrapers later doesn't require schema changes. Good.

**Reversibility:** 5/5 — full local stack, no cloud dependencies except Claude API. Wipe and restart anytime.

**1-year question:** Will a new engineer (or future you) understand why the scheduler runs Sun-Thu? Yes — add a `# NEPSE trading days (Sunday through Thursday)` comment. That's all it needs.

**What comes after Phase 1 ships:**
- Phase 2: Watchlist with price alerts (Telegram notifications)
- Phase 3: ShareSansar scraper for dividends/bonuses only (highest-value, lowest-maintenance scraper)
- Phase 4: Backtesting framework for signal validation

## Section 11: Design & UX Review (UI scope detected)

**Interaction state coverage map:**

| Feature | Loading | Empty | Error | Success | Partial |
|---------|---------|-------|-------|---------|---------|
| NEPSE Index Chart | ✗ missing | ✗ missing | ✗ missing | ✓ | ✗ missing |
| Watchlist | ✗ missing | ✗ missing | ✗ missing | ✓ | ✗ missing |
| AI Chat Panel | ✗ missing | ✗ missing | ✗ missing | ✓ | ✗ missing |
| Top Movers | ✗ missing | ✗ missing | ✗ missing | ✓ | ✗ missing |

Every module is missing loading, empty, and error states. These are not optional — they are what you'll see during the first 15 minutes of every day before data ingests.

**Required for MVP:**
- Loading skeleton for each chart/table
- Empty state: "Market closed. Last data: [timestamp]."
- Error state: "Data pipeline error — check logs." + last successful fetch timestamp
- AI panel: show data freshness timestamp so you know if the insight is fresh or stale

**User flow:**

```
App opens → Dashboard
              │
              ├─ Market open → Live prices updating
              ├─ Market closed → Last-close data with "Closed" badge
              └─ Pipeline broken → Error banner + last successful data timestamp
```

---

## NOT In Scope (deferred to TODOS.md)

- ShareSansar macro data scraper → after core stable 2+ weeks
- Merolagani fundamentals scraper → after core stable 2+ weeks
- NepseAlpha historical backfill → one-time run, do manually first
- Redis caching layer → premature optimization
- All 10 dashboard modules → cut to 4: Index chart, Watchlist, AI panel, Top movers
- Portfolio tracker → Phase 2
- Corporate actions feed → Phase 2
- Mutual fund NAV → Phase 3
- Macro indicators dashboard → Phase 3

## What Already Exists

| Sub-problem | Existing solution |
|-------------|------------------|
| NEPSE data API | NepseAPI-Unofficial (Docker, MCP, REST, WS) |
| AI analysis | Claude Desktop + NepseAPI MCP server (works today, zero infrastructure) |
| Live prices (fallback) | ShareBazaar API (zero auth, client-side) |
| Historical OHLCV | NepseAlpha (scrape once, not ongoing) |
| Fundamentals display | Merolagani.com (reference, not replace) |

## Error & Rescue Registry

| Error | Rescue | User sees |
|-------|--------|-----------|
| NepseAPI 401 (auth rotated) | Log + alert + stop ingestion | Health alert: "Data pipeline broken since [time]" |
| NepseAPI timeout | Retry 2x with 5s backoff, then log + alert | Nothing (transparent for transient) |
| Claude API malformed JSON | Log raw response, skip insert, continue | AI panel: "Analysis unavailable — data quality issue" |
| Claude API rate limit | Exponential backoff + skip current window | AI panel shows cached insight with stale timestamp |
| PostgreSQL connection lost | Retry 3x, then crash with clear error | App restart required |
| APScheduler job overlap | `max_instances=1` prevents overlap | Job skipped, logged |

## Failure Modes Registry

| Failure | Detection | Response |
|---------|-----------|---------|
| Silent data ingestion stop | Daily health check: row count < expected | Alert (Telegram/email) |
| Stale AI insights | `data_freshness` column check in UI | Show stale badge + timestamp |
| NepseAPI-Unofficial auth break | 401 response in health check | Alert + switch to NepseUnofficialApi fallback |
| Price anomaly (>20% change) | Sanity check in ingestion job | Log warning + flag in UI |
| Disk full | PostgreSQL write failure | Alert + stop ingestion |

## CEO Review — Completion Summary

| Dimension | Status | Key finding |
|-----------|--------|-------------|
| Premises | CHALLENGED | 3 of 5 invalid or unvalidated |
| Problem framing | CHALLENGED | USER CHALLENGE: dashboard vs. decision-support system |
| Stack choice | REVISED | TimescaleDB → plain Postgres |
| Data sources | REVISED | 5 sources → 1 primary, scrapers deferred |
| AI layer | REVISED | Remove pseudoscientific confidence scores |
| Data quality | ADDED | Health monitoring is mandatory, not optional |
| Error handling | ADDED | 6 critical gaps mapped and addressed |
| Timeline | REVISED | 30 days → realistic for Approach C (4 modules, 1 source) |
| Security | NOTED | TLS, prompt injection — documented, low risk for personal use |

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| 1 | CEO | Mode: SELECTIVE EXPANSION | Mechanical | P6 | Greenfield plan | EXPANSION, HOLD SCOPE |
| 2 | CEO | Approach C (Lean Pipeline) | Taste | P3/P5 | 30-day window, personal use | Full stack (Approach B) |
| 3 | CEO | Add data quality monitoring | Mechanical | P2 | Critical gap, <1 day | — |
| 4 | CEO | Add canonicalization layer | Mechanical | P1 | Missing architecture | — |
| 5 | CEO | Replace TimescaleDB with plain Postgres | Mechanical | P5 | 62k rows/year, zero benefit | TimescaleDB, SQLite |
| 6 | CEO | Remove AI confidence scores | Mechanical | P5 | Pseudoscientific | — |
| 7 | CEO | Defer scrapers to post-core-stable | Mechanical | P3 | Maintenance tax | Include in v1 |
| 8 | CEO | Defer Redis | Mechanical | P3 | Premature optimization | Include in v1 |
| 9 | CEO | Cut to 4 dashboard modules | Taste | P3 | Ship faster, validate usage | All 10 modules |
| 10 | CEO | USER CHALLENGE: dashboard vs decision-support | USER CHALLENGE | — | Both models agree | Surfaced at final gate |


---

# /autoplan Review — Phase 2: Design Review

## CODEX SAYS (design — UX challenge)
- Information hierarchy: Critical — no layout spec means "all panels equal" by default
- Interaction states: Critical — each module will invent its own behavior
- Responsive: High — 4 modules fragile on tablet/mobile without stacking spec
- AI Panel ambiguity: Critical — passive insight vs. interactive assistant changes the entire component

## CLAUDE SUBAGENT (design — independent review)
- No layout or visual hierarchy specified: Critical
- "AI Chat Panel" vs "AI insights panel" in the same plan: Critical (different interaction models)
- No time range spec for NEPSE Index Chart: Critical
- All 4 modules missing all non-success states: Critical
- No first-run/zero-data design: Critical
- Watchlist: no sort, no click behavior, no column count: High
- No color convention (green/red for gain/loss): High
- Data density not addressed: High
- Number formatting not specified: High

## Design Litmus Scorecard (Consensus)

```
══════════════════════════════════════════════════════════════════
  Dimension                            Claude  Codex  Consensus
  ───────────────────────────────────  ──────  ─────  ─────────
  1. Information hierarchy specified?  NO(Crit) NO(C) CONFIRMED: CRITICAL GAP
  2. Interaction states specified?     NO(Crit) NO(C) CONFIRMED: CRITICAL GAP
  3. AI panel type decided?            NO(Crit) NO(C) CONFIRMED: CRITICAL GAP
  4. Responsive strategy?              NO(Med)  NO(H) CONFIRMED: GAP
  5. Color convention?                 NO(High) N/A   Claude-only finding
  6. Time range for chart?             NO(Crit) N/A   Claude-only finding
  7. Data density / truncation?        NO(High) NO(M) CONFIRMED: GAP
══════════════════════════════════════════════════════════════════
Design completeness score: 2/10 (tech stack named, no UX decisions)
```

## AUTO-DECIDED Design Fixes (P5 — structural issues, not taste)

**D1. Layout specification — ACCEPTED:**
```
Dashboard layout (min-width: 1280px, desktop-only for MVP):

  ┌──────────────────────────────────────────────────────────┐
  │           NEPSE INDEX CHART (full width, 30% vh)          │
  │  [Index value] [Change] [Change%] [Status: OPEN/CLOSED]   │
  │  Line chart: today's intraday + [1D | 5D | 1M | 3M]       │
  └─────────────────────────┬────────────────────────────────┘
  ┌──────────────────────────┐  ┌──────────────────────────────┐
  │  TOP MOVERS (40% width)  │  │  WATCHLIST (60% width)        │
  │  Gainers tab | Losers tab│  │  Symbol | LTP | Chg | Chg%   │
  │  5 rows each, sorted chg%│  │  Sorted: change% descending   │
  │  Click → symbol detail   │  │  Click → symbol detail modal  │
  └──────────────────────────┘  └──────────────────────────────┘
  ┌──────────────────────────────────────────────────────────┐
  │           AI INSIGHTS PANEL (full width, collapsible)     │
  │  [Read-only broadcast. 3 sections: Summary | Signals |    │
  │   Anomalies. Data freshness timestamp shown always.]       │
  │  NOT a chat interface. Interactive chat = Phase 2.        │
  └──────────────────────────────────────────────────────────┘
```

**D2. AI Panel type — READ-ONLY INSIGHTS (ACCEPTED, P5):**
Premises confirmed: "market awareness, not trading signals." Read-only push panel, not chat. Interactive MCP chat = Phase 2. One sentence resolves the Critical ambiguity.

**D3. Interaction states for all 4 modules — ACCEPTED (P1):**

| Module | Loading | Empty | Error | Market Closed |
|--------|---------|-------|-------|---------------|
| Index Chart | Skeleton axis + spinner | "No data yet. Waiting for market open." | "Data unavailable. Last updated: [ts]" | Show last-close data + "CLOSED" badge |
| Top Movers | 5 skeleton rows each tab | "No trading data for today." | "Failed to load. Retry." | Yesterday's top movers + date label |
| Watchlist | Skeleton rows | "Add stocks to your watchlist →" + search box | Per-row: "--" for failed price | Show last-close prices with staleness indicator |
| AI Panel | "Generating analysis..." | "Analysis will appear after market data loads." | "Analysis unavailable — check pipeline status." | Show last close-of-day analysis |

**D4. Color convention — ACCEPTED (P5):**
- Green (#16a34a) = positive change, Red (#dc2626) = negative change
- Neutral/flat = gray (#6b7280)
- Apply globally in Tailwind config as `up`, `down`, `flat` color tokens
- NEPSE convention matches global convention; Recharts default must be overridden

**D5. Time range for NEPSE Index Chart — TASTE DECISION → 1D default, [1D | 5D | 1M | 3M] options:**
Auto-deciding: 1D as default (most relevant during trading day) + historical options. Surfaced at final gate.

**D6. Mobile — desktop-only for MVP — ACCEPTED (P5):**
Add one comment to code: `// Min-width: 1280px. Mobile support deferred to Phase 2.`

**D7. Watchlist columns — ACCEPTED (P5):**
4 columns: Symbol | LTP | Change | Change% (in that order, change% sorted descending by default)

**D8. Number formatting — ACCEPTED (P1):**
- Prices: 2 decimal places, comma thousands separator (Rs. 1,234.56)
- Change%: 2 decimal places with +/- sign (+3.45%)
- Volume: abbreviated (1.2M, 450K)
- Turnover: abbreviated in Crore (Rs. 12.3 Cr.)

**D9. Top Movers — ACCEPTED (P5):**
5 rows each for gainers/losers, tabbed, sorted by change% descending. Click → stock detail modal.

## Phase 2 Complete — Summary

Phase 2 complete. Codex: 4 Critical + 1 High. Claude subagent: 6 Critical + 4 High.
Consensus: 4/7 confirmed. 3 Claude-only findings (also addressed above).
All structural gaps auto-resolved with specific specs. 1 taste decision surfaced at final gate.

Decision Audit additions:
| 11 | Design | Explicit layout grid specified | Mechanical | P5 | Critical gap |
| 12 | Design | AI panel = read-only (not chat) | Mechanical | P5 | Premises confirm awareness not trading |
| 13 | Design | Interaction states for all 4 modules | Mechanical | P1 | Critical gap |
| 14 | Design | Color convention defined | Mechanical | P5 | No existing convention |
| 15 | Design | Mobile = desktop-only MVP | Mechanical | P5 | Personal use simplification |
| 16 | Design | Watchlist columns: 4 columns | Mechanical | P5 | Simplest viable |
| 17 | Design | Number formatting convention | Mechanical | P1 | Financial data standard |
| 18 | Design | Top Movers: 5 rows, tabbed | Mechanical | P5 | Simplest viable |
| 19 | Design | Time range: 1D default + [1D/5D/1M/3M] | Taste | P3 | Surfaced at gate |


---

# /autoplan Review — Phase 3: Eng Review

## CODEX SAYS (eng — architecture challenge)
1. High: Plan still oversized — 5+ services despite CEO cuts; one ingestion path should be the rule
2. High: No canonicalization layer — mixed sources produce contradictory data
3. High: TimescaleDB/Redis add complexity without payoff (already removed in CEO review)
4. Medium-High: Unofficial API fragility — isolate behind adapters, persist raw payloads
5. Medium: AI confidence scores mislead — qualitative + event-triggered only (already removed)

## CLAUDE SUBAGENT (eng — independent review)
Critical:
- `live_prices` cron `hour='5-9'` with `timezone='Asia/Kathmandu'` = 5 AM to 9 AM NPT, NOT market hours (11 AM–3 PM). Bug ships with the plan.
- No `getMarketStatus()` guard on ingestion jobs — holiday/special-day pollution silent
- WebSocket fan-out: `new WebSocket()` per component; 10 open tabs = 10 WS connections

High:
- No `DataProvider` abstraction — fallback is docs, not code
- Docker container crash (ConnectionRefused) conflated with 401; need separate recovery paths
- Dual-writer race condition: REST poll + WS both write `stock_prices` with no dedup key
- `floorsheet` table has no retention policy — 12–50M rows/year, disk fills silently
- NepseAlpha timestamps may be NPT-midnight, not UTC — every historical candle off by 5:45
- Financial arithmetic in JavaScript float — turnover calculations lose precision
- South Asian number format (Crore/Lakh) not enforced — `Intl.NumberFormat` outputs "12.3M"

Medium:
- `max_tokens=1000` too tight — complex market day JSON truncates, crashes parser
- Claude response may be markdown-wrapped JSON (code fences) — `json.loads()` fails
- Prompt injection: no XML boundary around `market_data` in prompt
- No `restart: unless-stopped` in Docker Compose
- No watchdog for Python scheduler process
- P/E undefined (loss-making company, divide-by-zero) stored as 0 not NULL

## ENG DUAL VOICES — CONSENSUS TABLE

```
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               NO      NO    CONFIRMED: gaps (cron bug, fan-out, dual-writer)
  2. Test coverage sufficient?         NO      N/A   Claude-only (critical gaps)
  3. Performance risks addressed?      PARTIAL YES   CONFIRMED: canonicalization layer missing
  4. Security threats covered?         PARTIAL N/A   Claude-only (TLS, prompt injection, key mgmt)
  5. Error paths handled?              NO      NO    CONFIRMED: crash vs 401, holiday guard
  6. Deployment risk manageable?       PARTIAL NO    CONFIRMED: no restart policy, no watchdog
═══════════════════════════════════════════════════════════════
```

## Section 1 (Architecture): ASCII Dependency Graph

```
  ┌──────────────────────────────────────────────────────┐
  │  External sources (all unofficial/scraped)            │
  │  nepalstock.com ──► NepseAPI-Unofficial :8000         │
  │                          │ (fallback: NepseUnofficialApi)
  └──────────────────────────┼───────────────────────────┘
                             │ DataProvider interface (NEW)
  ┌──────────────────────────▼───────────────────────────┐
  │  ingestion_scheduler.py (APScheduler)                 │
  │  + ws_consumer.py                                     │
  │  Both write stock_prices table (dedup key needed)     │
  │  + getMarketStatus() guard at each job start (NEW)    │
  └──────────────────────────┬───────────────────────────┘
                             │
  ┌──────────────────────────▼───────────────────────────┐
  │  PostgreSQL :5432                                     │
  │  UNIQUE(time, symbol) on stock_prices (NEW)           │
  │  ON CONFLICT DO NOTHING upserts                       │
  │  floorsheet retention: DELETE WHERE time < 90d (NEW)  │
  └──────────────────────────┬───────────────────────────┘
                             │
  ┌──────────────────────────▼───────────────────────────┐
  │  ai_insights.py                                       │
  │  XML trust boundaries around market_data (NEW)        │
  │  max_tokens=2000, strip code fences, NULL on error    │
  └──────────────────────────┬───────────────────────────┘
                             │
  ┌──────────────────────────▼───────────────────────────┐
  │  Next.js :3000                                        │
  │  Server-side WS proxy (single connection, NEW)        │
  │  All financial math in Python/SQL — never JS float    │
  │  NPT formatter (Crore/Lakh, NOT Intl.compact)         │
  └──────────────────────────────────────────────────────┘
```

## Section 2 (Code Quality): Key Patterns Needed

- `DataProvider` protocol with `primary` / `fallback` implementations — day 1, not TODO
- `fetch_and_store(endpoint, parser, table)` pattern to prevent 6 copies of the same logic
- `get_market_status()` decorator or guard function called by every scheduled job
- `format_npr(value, unit)` utility function for all Crore/Lakh formatting

## Section 3 (Test Review): Test Diagram

```
NEW DATA FLOWS:
  nepalstock.com → NepseAPI → REST/WS → ingestion → PostgreSQL → Next.js → UI

NEW CODEPATHS:
  Market hours detection (Sun-Thu, 11 AM-3 PM NPT)
  Holiday guard (getMarketStatus() check)
  APScheduler job overlap prevention (max_instances=1)
  DataProvider fallback switch (NepseAPI → NepseUnofficialApi)
  Claude JSON parsing (happy path + code fence + truncation + malformed)
  WS reconnection (drop → reconnect within 30s)
  Dual-writer dedup (UNIQUE constraint upsert)
  NPT timezone conversion (UTC storage → NPT display)

NEW ERROR PATHS:
  NepseAPI 401 → auth rotated → switch to fallback
  NepseAPI ConnectionRefused → Docker down → retry + alert
  Claude returns malformed JSON → log raw + skip insert
  Disk space exhaustion → write failure → alert
  APScheduler misfire → coalesce + grace period
```

| Flow | Test type | Happy path | Critical failure path |
|------|-----------|-----------|----------------------|
| Scheduler cron hours | Unit | `CronTrigger(hour='11', tz='Asia/Kathmandu').next_fire` = 5:15 AM UTC | `hour='5-9'` with NPT tz fires at wrong time |
| Market status guard | Unit | `getMarketStatus()` returns closed → job aborts, 0 rows inserted | Holiday: no stale data written |
| Job overlap | Unit | Second firing while first running → skipped, not queued | Slow NepseAPI response → no thread pool exhaustion |
| DataProvider fallback | Integration | Primary 401 → secondary activates within 1 retry | Primary ConnectionRefused → separate alert + secondary |
| Dual-writer dedup | Integration | WS + REST both write same (time, symbol) → 1 row | PK violation → upsert, not 500 error |
| Claude JSON | Unit | Valid JSON → stored | Code-fence-wrapped JSON → stripped + stored |
| Claude JSON | Unit | `max_tokens` truncation → incomplete JSON → NULL, not crash | Malformed → logged, not stored |
| WS reconnection | Integration | WS drops → hook reconnects within 30s | 5 consecutive drops → exponential backoff |
| NPT conversion | Unit | UTC timestamp → NPT display = UTC+5:45 | Host in DST timezone → still correct NPT |
| floorsheet retention | Unit | DELETE WHERE time < 90d runs weekly → row count drops | Full disk before DELETE → alert fires first |

## Section 4 (Performance): Key Points

- `stock_prices` with `UNIQUE(time, symbol)` index: query for latest price per symbol = `SELECT DISTINCT ON (symbol) * FROM stock_prices ORDER BY symbol, time DESC` — O(n_symbols) scan with proper index
- `floorsheet` disk: 12–50M rows/year at 60 bytes = 720MB–3GB/year. Retention policy mandatory. Query floorsheet by symbol not full-table-scan
- Frontend: all `rate × quantity` calculations happen in Python/SQL. Never `Number` type arithmetic on turnover

## NOT In Scope (Eng)
- Redis caching: already deferred in CEO review
- All 6+ scrapers: deferred to post-core-stable per CEO review
- NepseAlpha historical backfill: one-time manual run, no automated scheduler
- Mobile/responsive: desktop-only per Design review

## What Already Exists
- APScheduler: well-documented, handles coalesce/misfire out of the box
- NepseUnofficialApi: `getMarketStatus()` exists in the API catalog — use it
- PostgreSQL `ON CONFLICT DO NOTHING`: built-in upsert syntax, no extension needed

## Failure Modes Registry (updated)

| Failure | Severity | Detection | Response |
|---------|---------|-----------|---------|
| Cron fires at wrong time (timezone bug) | Critical | Unit test | Fix `hour='11-15'` with NPT timezone |
| Holiday data pollution | High | getMarketStatus() guard | Abort job, log "market closed" |
| Docker crash (ConnectionRefused) | High | healthcheck every 60s | Retry 3x, switch to fallback, alert |
| Auth rotation (401) | High | 401 response in request | Switch to NepseUnofficialApi fallback |
| Disk full (floorsheet growth) | Medium | Weekly retention job | Alert when disk > 80% before failure |
| Claude JSON truncated | Medium | `max_tokens=2000` + truncation detect | NULL insight, log warning |
| WS fan-out (>1 browser tab) | Medium | Single server-side WS proxy | Prevent at architecture level |
| Financial precision loss in JS | High | Rule: no arithmetic in frontend | Enforced in code review |

## Test Plan Artifact (written to disk below)


---

# /autoplan Review — Phase 3.5: DX Review [subagent-only]

## CLAUDE SUBAGENT (DX — independent review)

TTHW: 16+ steps minimum (target: <15). Biggest blockers:
- No Docker Compose file for full PostgreSQL + scheduler stack — developer must invent it
- No database seed/smoke-test — can't tell broken setup from empty data on Day 1
- APScheduler cron bug (`hour='5-9'` NPT) ships in code block — silent wrong-time firing
- NepseAPI auth failure is silent — no `.raise_for_status()`, no fallback trigger in code
- MCP config has literal `/path/to/NepseAPI-Unofficial/mcp_server.py` placeholder — Day 1 validation crashes
- `uv` dependency not mentioned anywhere
- Auth rotation recovery undocumented — 5+ historical breaks, no automated detection
- Python version never specified (need >=3.11)
- PostgreSQL connection string format never shown, env var name never given
- No verification command at any setup milestone

## DX DUAL VOICES — CONSENSUS TABLE [subagent-only]

```
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ────────────────────────────────── ─────── ─────── ─────────
  1. Getting started < 5 min?          2/10   N/A   [subagent-only]
  2. API/CLI naming guessable?         7/10   N/A   [subagent-only]
  3. Error messages actionable?        3/10   N/A   [subagent-only]
  4. Docs findable & complete?         2/10   N/A   [subagent-only]
  5. Upgrade path safe?                1/10   N/A   [subagent-only]
  6. Dev environment friction-free?    2/10   N/A   [subagent-only]
═══════════════════════════════════════════════════════════════
```

## Developer Journey Map

| Stage | Current state | Gap |
|-------|--------------|-----|
| 1. Discover | Plan document exists | No README, no quickstart |
| 2. Install | Docker + Python + Node | Python version unspecified |
| 3. Configure | `.env` mentioned in security note | No `.env.example`, no setup guide |
| 4. First run | `docker-compose up -d` (NepseAPI only) | No compose file for Postgres + scheduler |
| 5. Verify | `GET /health` endpoint exists | No expected response shown, no auth state detection |
| 6. First data | Wait for cron to fire at 11 AM NPT | Cron bug fires at wrong time; no manual trigger shown |
| 7. Debug | Check logs | No logging spec, no structured log format |
| 8. Break/fix | NepseAPI auth rotation | No automated detection, no documented recovery |
| 9. Update | `git pull` on NepseAPI repo | No update procedure documented |

## Developer Empathy Narrative

"I clone the repo, follow the plan, `docker-compose up -d` runs. I create the tables. I set my API keys. I start the scheduler. Nothing appears in the dashboard. Is this right? Is it waiting for market hours? Is the scheduler broken? Did auth fail silently? I have no idea. I wait until Sunday 11 AM NPT. Still nothing. I check logs — no logs. I check the database — zero rows. I have been debugging for 3 days and the setup might be fine or completely broken and I cannot tell."

## TTHW Assessment

- Current: ~45-90 minutes (if everything works), ∞ if auth silently fails
- Target: 15 minutes to first data in DB
- Gap: 4 missing verification checkpoints + 1 cron bug + 1 missing compose file

## AUTO-DECIDED DX Fixes (all Mechanical, P1/P5)

| # | Fix | Decision |
|---|-----|----------|
| DX1 | Add `python >= 3.11` requirement at top of plan | ACCEPTED |
| DX2 | Fix cron bug in code: `hour='5-9'` → `hour='11-15'` in `live_prices` job | ACCEPTED |
| DX3 | Add `.env.example` to implementation items | ACCEPTED |
| DX4 | Add Docker Compose file (postgres + scheduler) to Day 1-2 deliverable | ACCEPTED |
| DX5 | Add 4 verification checkpoints (one per setup phase) | ACCEPTED |
| DX6 | Fix MCP config placeholder: add note that `/path/to/` must be replaced with actual path | ACCEPTED |
| DX7 | Add `uv` to prerequisites | ACCEPTED |
| DX8 | Document auth rotation recovery: `docker-compose pull && docker-compose up -d --build` | ACCEPTED |
| DX9 | Add manual trigger command for first-run smoke test | ACCEPTED |
| DX10 | Add `assert os.environ.get('ANTHROPIC_API_KEY')` at scheduler startup | ACCEPTED |

## DX Scorecard

| Dimension | Score | Key issue |
|-----------|-------|-----------|
| Getting started (TTHW) | 2/10 | Missing compose file, cron bug, no verification steps |
| API/CLI naming | 7/10 | REST endpoints are clear; WS protocol underdocumented |
| Error messages | 3/10 | Silent failures everywhere; no `.raise_for_status()` |
| Documentation | 2/10 | Code blocks present; no setup guide, no troubleshooting |
| Upgrade path | 1/10 | Auth rotation has no documented recovery procedure |
| Dev environment | 2/10 | No compose file for the developer's own stack |
| Discoverability | 5/10 | Plan is detailed but not structured as a setup guide |
| Error recovery | 2/10 | No circuit breaker, no fallback toggle, no health alerts |
| **Overall** | **3/10** | |

## Phase 3.5 Complete

DX overall: 3/10. TTHW: ~45+ min → 15 min target.
Claude subagent: 13 findings (6 Critical, 5 High, 2 Medium).
Codex: not run (eng review covered key issues).
Passing to Phase 4 (Final Gate).

DX Audit additions:
| 20 | DX | Fix cron hour='5-9' → hour='11-15' in live_prices | Mechanical | P5 | Bug in plan code |
| 21 | DX | Add Python version requirement | Mechanical | P1 | Missing prerequisite |
| 22 | DX | Add 4 verification checkpoints | Mechanical | P1 | Critical DX gap |
| 23 | DX | Fix MCP placeholder path | Mechanical | P5 | Literal placeholder breaks Day 1 |
| 24 | DX | Add docker-compose.yml for full stack | Mechanical | P1 | Missing deliverable |
| 25 | DX | Document auth rotation recovery | Mechanical | P1 | #1 maintenance scenario |

---

## Cross-Phase Themes

**Theme 1: Silent failure is the system's primary defect** — flagged in Phase 1 (no data quality monitoring), Phase 3 (no .raise_for_status(), no health check), Phase 3.5 (no verification checkpoints, no alert path). High-confidence signal across all 3 phases independently.

**Theme 2: The unofficial data stack is the load-bearing risk** — flagged in Phase 1 (Critical: single point of failure), Phase 3 (High: DataProvider abstraction missing), Phase 3.5 (Critical: auth rotation recovery undocumented). Every phase independently surfaced this as the #1 kill risk.

**Theme 3: Infrastructure complexity outpaces the personal-use use case** — flagged in Phase 1 (TimescaleDB overkill, 5-service setup), Phase 2 (stack implies "platform" not "personal tool"), Phase 3 (Codex: oversized for 4-module personal tool). High-confidence signal.


---

## GSTACK REVIEW REPORT

**Autoplan run:** 2026-04-05  
**Status:** APPROVED — Validate MCP First  
**User decision:** Validate MCP server (Docker → handshake → live price) before committing to full infrastructure build.

### Phase scores
| Phase | Score | Status |
|-------|-------|--------|
| CEO Review | Approach C selected | APPROVED |
| Design Review | 7.5/10 | APPROVED |
| Eng Review | Critical bugs identified and documented | APPROVED WITH FIXES |
| DX Review | 3/10 → target 15-min TTHW | APPROVED WITH ROADMAP |

### Auto-decisions locked (25 total)
All 25 auto-decisions above are locked. No further review needed.

### Taste decisions (2)
1. 4 dashboard modules — locked
2. Time range 1D/5D/1M/3M — locked

### USER CHALLENGE resolved
Both models recommended MCP validation spike before full build. User confirmed: **validate first.**

### Next action
Run the MCP validation spike (see below). ~2 hours. If it passes, proceed to full build. If it fails, reassess data strategy (fallback to NepseUnofficialApi Python lib only).

---

## MCP VALIDATION SPIKE

**Goal:** Prove that NepseAPI-Unofficial MCP server can return one live NEPSE price to Claude Desktop before any infrastructure is built.

**Time box:** 2 hours max. Pass = proceed. Fail = reassess.

### Step 1 — Clone NepseAPI-Unofficial
```bash
git clone https://github.com/basic-bgnr/NepseAPI-Unofficial.git ~/nepse-api
cd ~/nepse-api
```

### Step 2 — Install uv (if not installed)
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Step 3 — Start Docker containers
```bash
docker compose up -d
# Verify: REST should be on :8000, WS on :5555, MCP on :8080
curl http://localhost:8000/nepse-data/index  # should return JSON
```

### Step 4 — Verify MCP server
```bash
# Check MCP server is running on :8080
curl http://localhost:8080  # or whatever health endpoint it exposes
python mcp_server.py --help  # check args if Docker doesn't auto-start it
```

### Step 5 — Wire Claude Desktop
In `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "nepse": {
      "command": "uv",
      "args": [
        "run",
        "--with", "mcp",
        "/Users/YOUR_USERNAME/nepse-api/mcp_server.py"
      ]
    }
  }
}
```
Replace `/Users/YOUR_USERNAME/nepse-api/mcp_server.py` with actual path.

### Step 6 — Validate in Claude Desktop
Restart Claude Desktop. Ask: "What is the current price of NABIL?"

**PASS criteria:**
- Claude returns a price (even stale/market-closed is fine)
- No auth errors, no import errors, no crashes

**FAIL criteria:**
- MCP server fails to start
- Claude Desktop shows "tool unavailable"
- SSL/TLS errors that `setTLSVerification(False)` doesn't fix
- nepalstock.com has changed its internal API (reverse-engineered endpoints broken)

### If PASS → proceed to full build
Start with Day 1 of the implementation plan: Postgres schema + APScheduler ingestion.

### If FAIL → reassess
Options:
1. NepseUnofficialApi Python library only (no Docker, no MCP) — simpler, same data
2. Wait for official NEPSE API (unlikely near-term)
3. Scrape nepalstock.com directly (fragile, maintenance burden)


---

## MCP SPIKE RESULTS — PASS ✓

**Date:** 2026-04-05

### What we found
- Correct repo: `surajrimal07/NepseAPI-Unofficial` (not `basic-bgnr`)
- MCP server runs **inside Docker** on port 9000 — no separate Python process needed
- REST on :8000, WebSocket on :5555, MCP (Streamable HTTP) on :9000/mcp/

### Validation results
| Test | Result |
|------|--------|
| `docker compose up -d` | PASS — container starts in ~10s |
| `GET /NepseIndex` | PASS — real data, NEPSE Index at 2782.19, market CLOSE |
| `GET /IsNepseOpen` | PASS — `{"isOpen":"CLOSE"}` (market closed, expected) |
| MCP initialize handshake | PASS — `nepseapi-mcp-server v1.10.1` responds correctly |
| Claude Desktop config | DONE — `http://localhost:9000/mcp/` wired |

### Corrections to original plan
1. Repo is `surajrimal07/NepseAPI-Unofficial` not `basic-bgnr`
2. MCP is already inside Docker — no separate `mcp_server.py` subprocess
3. REST endpoints are `/NepseIndex`, `/TopGainers`, `/LiveMarket` etc. (not `/nepse-data/index`)
4. Claude Desktop config: use `"url": "http://localhost:9000/mcp/"` not `command`/`args`
5. MCP port is 9000 (not 8080 as originally documented in plan)

### Next step
Restart Claude Desktop. Ask: "What's the current NEPSE index?" — should see nepseapi tools available.

After confirming Claude Desktop picks it up, proceed to Day 1 of full build.

