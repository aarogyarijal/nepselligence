# NEPSE AI Dashboard Frontend

Next.js 14 dashboard for NEPSE market data with AI-generated insights.

## Features

- **Index Chart**: Real-time NEPSE Index visualization with Recharts
- **Top Movers**: Gainers and losers tabs with live price data
- **Watchlist**: Customizable tracked stocks with price updates
- **AI Panel**: Read-only broadcast of Claude-generated market insights
- **Time Range Selector**: View data for 1D, 5D, 1M, 3M ranges
- **Desktop-only MVP**: Optimized for desktop (min-width: 1280px)

## Tech Stack

- Next.js 14 (App Router)
- React 18
- TypeScript
- Recharts (charting)
- Tailwind CSS (styling)

## Setup

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Production build
npm run build
npm start

# Type checking
npm run type-check
```

## Layout Specification

```
┌──────────────────────────────────────────────────────────┐
│           NEPSE INDEX CHART (full width, 30% vh)          │
│  Line chart: today's intraday + [1D | 5D | 1M | 3M]       │
└─────────────────────────┬────────────────────────────────┘
┌──────────────────────────┐  ┌──────────────────────────────┐
│  TOP MOVERS (40% width)  │  │  WATCHLIST (60% width)        │
│  Gainers tab | Losers tab│  │  Symbol | LTP | Chg | Chg%   │
└──────────────────────────┘  └──────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│           AI INSIGHTS PANEL (full width, collapsible)     │
│  Read-only broadcast. NOT a chat interface.               │
└──────────────────────────────────────────────────────────┘
```

## API Endpoints

The frontend connects to the backend on `http://localhost:8080`:

- `GET /health` — Server health check
- `GET /api/stocks/latest` — Latest prices for all symbols
- `GET /api/stocks/{symbol}/floorsheet` — Recent trades for symbol

## Development Notes

- Components use mock data until backend is fully integrated
- Desktop-only constraint enforced via CSS (mobile browsers show overlay message)
- Time range selector is functional but deferred data fetching to Phase 2
- AI Panel uses mock insight text; integrates with Claude API in Phase 2
- No WebSocket connections (deferred per design review)
- All calculations happen server-side (Python/PostgreSQL)

## Next Steps

- [ ] Connect to backend API endpoints (replace mock data)
- [ ] Implement WebSocket proxy for live price updates
- [ ] Add Claude API integration for live insights
- [ ] Implement floorsheet detail modal
- [ ] Add symbol search / add to watchlist
- [ ] Mobile responsive design (Phase 2)
