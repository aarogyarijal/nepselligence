# NEPSE AI Dashboard Frontend

Next.js 14 dashboard for NEPSE market data with AI-generated insights.

## Features

- **Index Chart** — NEPSE Index area chart with 1D–5Y range selector and interval picker
- **Sector Performance** — Intraday sector heatmap widget
- **Top Gainers / Losers / Turnover Leaders** — Live rankings with floorsheet icon per row
- **Market Breadth** — Advance/decline/unchanged breakdown
- **Floorsheet Modal** — Per-symbol raw trade history (buyer/seller/qty/rate), opened from any movers widget
- **AI Insights Panel** — Claude-generated market summaries (open briefing, hourly, daily close, weekly wrap) with insight type badge and today's history timeline
- **News Feed** — Paginated market and per-stock news with category filter
- **Stock Detail Pages** — Full `/stock/{symbol}` with candlestick chart, SMA/EMA/Bollinger overlays, technicals card, signals, returns, volatility, relative performance, floorsheet table, per-stock AI insight and chat
- **Symbol Search** — Header autocomplete navigates to `/stock/{symbol}`
- **Admin Controls** — Collapsed footer with manual scheduler trigger buttons
- **Desktop-first** — Optimized for 1280px+ screens, dark slate theme

## Tech Stack

- Next.js 14 (App Router)
- React 18
- TypeScript (strict mode)
- Recharts (area chart, candlestick)
- Tailwind CSS

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

## Environment

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8080
```

## Architecture Notes

- All API calls go through `src/lib/api.ts` — typed fetch wrappers with in-flight request deduplication (same path won't fire twice concurrently)
- `usePolling` adds 20% random jitter to stagger concurrent poll timers and respects the Page Visibility API (pauses when tab is hidden)
- `useAbortController` provides clean fetch cancellation for components that start new requests before the previous one finishes
- All pure display components are wrapped in `React.memo`. Callback props in `page.tsx` use `useCallback` so memo actually prevents re-renders
- Stock chart switches between line (multi-day ranges) and candlestick (1D) automatically based on data type returned by the API
