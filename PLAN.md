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
