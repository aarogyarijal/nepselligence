"""Claude API integration for generating NEPSE market insights."""

import json
import logging
import re
from datetime import datetime, timezone, timedelta, date
import zoneinfo

NPT = zoneinfo.ZoneInfo("Asia/Kathmandu")

from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from .config import settings
from .models import AIInsight, MarketSummary, DailySectorIndex, DailyMarketBreadth, NewsArticle

logger = logging.getLogger(__name__)

# Insight types
MARKET_OPEN = "market_open"
HOURLY = "hourly"
DAILY_CLOSE = "daily_close"
WEEKLY_WRAP = "weekly_wrap"


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences if Claude wraps response in them."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _gather_market_context(db: Session) -> dict:
    """Pull current market data for use in prompts."""
    ctx = {}

    # Latest NEPSE index snapshot
    summary = db.query(MarketSummary).order_by(MarketSummary.time.desc()).first()
    if summary:
        ctx["index"] = {
            "value": summary.nepse_index,
            "change": summary.nepse_change,
            "change_pct": summary.nepse_change_pct,
            "turnover": summary.total_turnover,
            "shares": summary.total_shares,
            "transactions": summary.total_transactions,
            "as_of": summary.time.astimezone(NPT).isoformat(),
        }

    # Top 5 gainers/losers from latest prices
    latest_prices = db.execute(sql_text("""
        SELECT DISTINCT ON (symbol) symbol, ltp, change_percent, time
        FROM stock_prices
        ORDER BY symbol, time DESC
    """)).fetchall()

    if latest_prices:
        sorted_prices = sorted(
            [r for r in latest_prices if r.change_percent is not None],
            key=lambda r: r.change_percent,
            reverse=True,
        )
        ctx["top_gainers"] = [
            {"symbol": r.symbol, "ltp": r.ltp, "change_pct": r.change_percent}
            for r in sorted_prices[:5]
        ]
        ctx["top_losers"] = [
            {"symbol": r.symbol, "ltp": r.ltp, "change_pct": r.change_percent}
            for r in sorted_prices[-5:][::-1]
        ]

    # Today's sector performance
    today = date.today()
    sectors = db.query(DailySectorIndex).filter(DailySectorIndex.date == today).all()
    if sectors:
        ctx["sectors"] = [
            {"name": s.sector_name, "change_pct": s.change_pct}
            for s in sorted(sectors, key=lambda s: (s.change_pct or 0), reverse=True)
        ]

    # Today's market breadth
    breadth = db.query(DailyMarketBreadth).filter(DailyMarketBreadth.date == today).first()
    if breadth:
        ctx["breadth"] = {
            "advances": breadth.advances,
            "declines": breadth.declines,
            "unchanged": breadth.unchanged,
            "ad_ratio": breadth.ad_ratio,
        }

    # Recent news headlines (last 24 hours)
    news_cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    recent_news = (
        db.query(NewsArticle)
        .filter(NewsArticle.published_at >= news_cutoff)
        .order_by(NewsArticle.published_at.desc())
        .limit(10)
        .all()
    )
    if recent_news:
        ctx["recent_news"] = [
            {
                "title": n.title,
                "category": n.category,
                "symbols": n.symbols or [],
            }
            for n in recent_news
        ]

    # Today's floorsheet summary (top traded + block trade activity)
    fs_summary = db.execute(sql_text("""
        SELECT symbol,
               COUNT(*) AS trades,
               SUM(amount) AS turnover,
               SUM(amount) / NULLIF(SUM(quantity), 0) AS vwap,
               COUNT(*) FILTER (WHERE quantity > 5000) AS block_count
        FROM floorsheet
        WHERE business_date = :today
        GROUP BY symbol
        ORDER BY SUM(amount) DESC
        LIMIT 10
    """), {"today": today}).fetchall()
    if fs_summary:
        ctx["floorsheet_leaders"] = [
            {
                "symbol": r.symbol,
                "trades": int(r.trades),
                "turnover": round(r.turnover, 0),
                "vwap": round(r.vwap, 2) if r.vwap else None,
                "blockTrades": int(r.block_count),
            }
            for r in fs_summary
        ]

    return ctx


def _gather_week_context(db: Session) -> list[dict]:
    """Gather the last 5 trading days of summary data for weekly wrap."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=8)
    rows = db.execute(sql_text("""
        SELECT DATE(time AT TIME ZONE 'Asia/Kathmandu') AS trade_date,
               AVG(nepse_index) AS avg_index,
               MAX(nepse_index) AS high_index,
               MIN(nepse_index) AS low_index,
               MAX(total_turnover) AS turnover
        FROM market_summary
        WHERE time >= :cutoff
        GROUP BY trade_date
        ORDER BY trade_date ASC
    """), {"cutoff": cutoff}).fetchall()
    return [
        {
            "date": str(r.trade_date),
            "avg_index": round(r.avg_index, 2) if r.avg_index else None,
            "high": round(r.high_index, 2) if r.high_index else None,
            "low": round(r.low_index, 2) if r.low_index else None,
            "turnover": r.turnover,
        }
        for r in rows
    ]


def _news_section(ctx: dict) -> str:
    """Format recent news headlines for injection into prompts."""
    news = ctx.get("recent_news")
    if not news:
        return ""
    return f"""
<recent_news>
{json.dumps(news, indent=2)}
</recent_news>
"""


def _strip_news(ctx: dict) -> dict:
    """Return ctx without recent_news key (avoid duplication in market_data block)."""
    return {k: v for k, v in ctx.items() if k != "recent_news"}


def _market_focus_context(focus: list[str]) -> str:
    """Build a focus instruction string for market prompts."""
    if not focus:
        return ""
    labels = {
        "index": "NEPSE index levels and direction",
        "sectors": "sector rotation and sub-index performance",
        "breadth": "market breadth (advance/decline ratio)",
        "movers": "top gaining and losing stocks",
    }
    selected = [labels[f] for f in focus if f in labels]
    if not selected:
        return ""
    return f"Prioritize: {', '.join(selected)}."


def _market_depth_instructions(depth: str) -> tuple[str, str]:
    """Return (word_limit_str, detail_instruction) for a given depth."""
    if depth == "brief":
        return "under 120 words", "Be extremely concise — one sentence per section maximum."
    return "under 280 words", "Be thorough and specific with numbers."


def _build_open_prompt(ctx: dict, options: dict | None = None) -> str:
    opts = options or {}
    focus_ctx = _market_focus_context(opts.get("focus", []))
    word_limit, detail_instr = _market_depth_instructions(opts.get("depth", "detailed"))
    news_block = _news_section(ctx)
    market_data = _strip_news(ctx)
    return f"""You are a NEPSE market analyst. The Nepal Stock Exchange (NEPSE) has just opened for trading.
{f"Configuration: {focus_ctx}" if focus_ctx else ""}
<market_data>
{json.dumps(market_data, indent=2)}
</market_data>
{news_block}
Write a morning market briefing in plain text (no markdown, no code fences) with exactly 3 sections:

1. SUMMARY: One sentence on the opening context — yesterday's close, index level, and initial market tone.
2. SIGNALS: Two to three stocks or sectors worth watching today based on recent momentum.
3. ANOMALIES: Any pre-market observations or risks to watch (high breadth imbalance, sector weakness, relevant news events, etc.).

Keep the total {word_limit}. {detail_instr} Be factual and specific. Reference any relevant recent news where it adds context."""


def _build_hourly_prompt(ctx: dict, options: dict | None = None) -> str:
    opts = options or {}
    focus_ctx = _market_focus_context(opts.get("focus", []))
    word_limit, detail_instr = _market_depth_instructions(opts.get("depth", "detailed"))
    news_block = _news_section(ctx)
    market_data = _strip_news(ctx)
    return f"""You are a NEPSE market analyst providing a mid-session update.
{f"Configuration: {focus_ctx}" if focus_ctx else ""}
<market_data>
{json.dumps(market_data, indent=2)}
</market_data>
{news_block}
Write a mid-session update in plain text (no markdown, no code fences) with exactly 3 sections:

1. SUMMARY: One sentence on current market direction — NEPSE level, change, and intraday breadth.
2. SIGNALS: Two stocks showing notable intraday strength or weakness and why they stand out.
3. ANOMALIES: Any unusual activity — sector rotation, volume spikes, breadth extremes, or news-driven moves.

Keep the total {word_limit}. {detail_instr} Be specific about numbers (index level, % changes)."""


def _build_close_prompt(ctx: dict, day_insights: list[str], options: dict | None = None) -> str:
    opts = options or {}
    focus_ctx = _market_focus_context(opts.get("focus", []))
    word_limit, detail_instr = _market_depth_instructions(opts.get("depth", "detailed"))
    news_block = _news_section(ctx)
    market_data = _strip_news(ctx)
    prior = "\n\n".join(day_insights) if day_insights else "No earlier insights today."
    return f"""You are a NEPSE market analyst writing the end-of-day market summary.
{f"Configuration: {focus_ctx}" if focus_ctx else ""}
<market_data>
{json.dumps(market_data, indent=2)}
</market_data>
{news_block}
<earlier_insights_today>
{prior}
</earlier_insights_today>

Write an end-of-day analysis in plain text (no markdown, no code fences) with exactly 3 sections:

1. SUMMARY: Two to three sentences summarizing the full trading session — final NEPSE level, overall direction, turnover, and market breadth conclusion.
2. SIGNALS: Three to four stocks worth monitoring tomorrow based on today's close — include price levels and reasons.
3. ANOMALIES: Notable events from today's session — sector concentration, unusual volumes, large swings, breadth extremes, or news events that drove moves.

Keep the total {word_limit}. {detail_instr} Reference the earlier intraday insights where relevant. Incorporate any news headlines that explain today's price action."""


def _build_weekly_prompt(ctx: dict, week_data: list[dict], options: dict | None = None) -> str:
    opts = options or {}
    focus_ctx = _market_focus_context(opts.get("focus", []))
    word_limit, detail_instr = _market_depth_instructions(opts.get("depth", "detailed"))
    news_block = _news_section(ctx)
    market_data = _strip_news(ctx)
    return f"""You are a NEPSE market analyst writing the weekly market wrap.
{f"Configuration: {focus_ctx}" if focus_ctx else ""}
<this_week_data>
{json.dumps(week_data, indent=2)}
</this_week_data>

<latest_session>
{json.dumps(market_data, indent=2)}
</latest_session>
{news_block}
Write a weekly market wrap in plain text (no markdown, no code fences) with exactly 3 sections:

1. SUMMARY: Two to three sentences on the week's overall performance — net NEPSE change, high/low range, and total turnover trajectory.
2. SIGNALS: Three stocks or sectors that defined the week — both leaders and laggards with context.
3. ANOMALIES: Any week-level themes worth watching next week — trends, reversals, volume patterns, macro signals, or news-driven catalysts.

Keep the total {word_limit}. {detail_instr} Be analytical, not just descriptive. Reference key news events from the week where relevant."""


async def generate_insight(db: Session, provider_manager, insight_type: str, options: dict | None = None, force: bool = False) -> None:
    """Generate and store a Claude insight of the specified type. Skips if no API key.

    Pass force=True to bypass the holiday guard (used by manual admin triggers).
    """
    if not settings.claude_api_key:
        logger.info("No CLAUDE_API_KEY configured, skipping AI insight generation")
        return

    ctx = _gather_market_context(db)
    if not ctx.get("index"):
        logger.info("No market data available, skipping AI insight")
        return

    # Holiday guard: skip if the market hasn't had any activity in the last 8 hours.
    # This prevents wasting Claude API calls on weekends and public holidays.
    # Bypassed when force=True (manual admin trigger).
    if not force:
        recent_cutoff = datetime.now(timezone.utc) - timedelta(hours=8)
        recent_activity = db.query(MarketSummary).filter(
            MarketSummary.time >= recent_cutoff
        ).first()
        if not recent_activity:
            logger.info("No market activity in last 8h (holiday or weekend), skipping AI insight")
            return

    opts = options or {}

    # Pick prompt and model based on type
    if insight_type == MARKET_OPEN:
        prompt = _build_open_prompt(ctx, opts)
        model = settings.claude_model_fast
    elif insight_type == HOURLY:
        prompt = _build_hourly_prompt(ctx, opts)
        model = settings.claude_model_fast
    elif insight_type == WEEKLY_WRAP:
        week_data = _gather_week_context(db)
        prompt = _build_weekly_prompt(ctx, week_data, opts)
        model = settings.claude_model_deep
    else:  # DAILY_CLOSE (default)
        today_insights = db.query(AIInsight).filter(
            AIInsight.generated_at >= datetime.now(timezone.utc).replace(hour=0, minute=0, second=0),
            AIInsight.insight_type.in_([MARKET_OPEN, HOURLY]),
        ).order_by(AIInsight.generated_at.asc()).all()
        day_texts = [i.insight_text for i in today_insights]
        prompt = _build_close_prompt(ctx, day_texts, opts)
        model = settings.claude_model_deep

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.claude_api_key)
        message = client.messages.create(
            model=model,
            max_tokens=settings.claude_api_max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = message.content[0].text if message.content else ""
        insight_text = _strip_code_fences(raw_text)

        if not insight_text:
            logger.warning("Claude returned empty insight, skipping")
            return

        insight = AIInsight(
            generated_at=datetime.now(timezone.utc),
            insight_type=insight_type,
            insight_text=insight_text,
            symbol=None,
            extra_data={
                "nepse_index": ctx.get("index", {}).get("value"),
                "nepse_change_pct": ctx.get("index", {}).get("change_pct"),
                "model": model,
            },
        )
        db.add(insight)
        db.commit()
        logger.info(f"AI insight generated: type={insight_type}, model={model}")

    except ImportError:
        logger.error("anthropic package not installed. Run: pip install anthropic")
    except Exception as e:
        logger.error(f"Claude API call failed: {e}")
        db.rollback()


# Backward-compatible alias used by existing scheduler job
async def generate_market_insight(db: Session, provider_manager) -> None:
    await generate_insight(db, provider_manager, DAILY_CLOSE)


STOCK_INSIGHT = "stock_insight"


def _build_stock_insight_prompt(symbol: str, analysis: dict, options: dict | None = None, news: list | None = None) -> str:
    """Build prompt for stock-specific one-shot analysis. options shapes horizon, signals, and goal."""
    opts = options or {}
    horizon = opts.get("horizon", "medium_term")
    goal = opts.get("goal", "neutral")
    active_signals = set(opts.get("signals") or ["trend", "momentum", "volume", "volatility", "relperf"])

    p = analysis.get("price") or {}
    r = analysis.get("returns") or {}
    t = analysis.get("technicals") or {}
    v = analysis.get("volume") or {}
    vol = analysis.get("volatility") or {}
    rp = analysis.get("relativePerformance") or {}
    sig = analysis.get("signals") or {}
    macd_d = t.get("macd") or {}
    bb = t.get("bollingerBands") or {}
    ltp = p.get("ltp", 0)
    cpct = p.get("changePct", 0) or 0

    def _f(val, dec=2):
        return f"{val:.{dec}f}" if val is not None else "N/A"

    # Horizon context
    horizon_label = {
        "short_term":  "SHORT-TERM (1–5 day trade setup) — prioritize intraday momentum, near-term support/resistance",
        "medium_term": "MEDIUM-TERM (1–4 week swing trade) — prioritize SMA20/50 alignment, MACD trend, volume confirmation",
        "long_term":   "LONG-TERM (1–6 month position) — prioritize SMA50/200 alignment, 52-week range context, alpha vs NEPSE",
    }.get(horizon, "MEDIUM-TERM (1–4 week swing trade)")

    # Goal context
    goal_label = {
        "entry": "Goal: identify entry points — emphasize oversold conditions, support levels, favorable risk/reward",
        "exit":  "Goal: evaluate exit/take-profit — emphasize overbought conditions, resistance levels, momentum divergence",
        "risk":  "Goal: risk assessment — emphasize volatility, ATR-based stop levels, downside support gaps",
    }.get(goal, "")

    # Returns filtered by horizon
    if horizon == "short_term":
        returns_line = f"Returns: 1D={_f(r.get('1d'))}%, 5D={_f(r.get('5d'))}%"
    elif horizon == "long_term":
        returns_line = f"Returns: 1M={_f(r.get('1m'))}%, 3M={_f(r.get('3m'))}%, 6M={_f(r.get('6m'))}%, 1Y={_f(r.get('1y'))}%"
    else:
        returns_line = f"Returns: 1D={_f(r.get('1d'))}%, 5D={_f(r.get('5d'))}%, 1M={_f(r.get('1m'))}%, 3M={_f(r.get('3m'))}%"

    # Build data sections selectively
    data_parts = [
        f"Price: Rs {_f(ltp)} ({'+' if cpct >= 0 else ''}{_f(cpct)}% today, prev close Rs {_f(p.get('prevClose'))})",
        f"52W range: Rs {_f(p.get('low52w'))} – Rs {_f(p.get('high52w'))} (at {(p.get('rangePosition') or 0)*100:.0f}% of range), ATH Rs {_f(p.get('allTimeHigh'))}",
        returns_line,
    ]

    if "momentum" in active_signals:
        data_parts.append(
            f"Momentum: RSI(14)={_f(t.get('rsi14'))}, "
            f"MACD={_f(macd_d.get('macd'))}/Signal={_f(macd_d.get('signal'))}/Hist={_f(macd_d.get('histogram'))}"
        )

    if "trend" in active_signals:
        sma_parts = [f"SMA20=Rs {_f(t.get('sma20'))}", f"SMA50=Rs {_f(t.get('sma50'))}"]
        if horizon != "short_term":
            sma_parts.append(f"SMA200=Rs {_f(t.get('sma200'))}")
        sma_parts += [f"EMA12=Rs {_f(t.get('ema12'))}", f"EMA26=Rs {_f(t.get('ema26'))}"]
        data_parts.append("Trend: " + ", ".join(sma_parts))

    if "volatility" in active_signals:
        data_parts.append(
            f"Volatility: ATR(14)=Rs {_f(t.get('atr14'))}, "
            f"Bollinger={_f(bb.get('lower'))}|{_f(bb.get('middle'))}|{_f(bb.get('upper'))}, "
            f"Daily(30D)={_f((vol.get('daily30d') or 0)*100)}%"
        )

    if "volume" in active_signals:
        data_parts.append(
            f"Volume: Today={v.get('latest')}, 20D avg={_f(v.get('avg20d'), 0)}, ratio={_f(v.get('volumeRatio'))}x"
        )

    if "relperf" in active_signals:
        data_parts.append(
            f"vs NEPSE(30D): Stock={_f(rp.get('stockReturn30d'))}%, NEPSE={_f(rp.get('nepseReturn30d'))}%, Alpha={_f(rp.get('alpha30d'))}%"
        )

    data_parts.append(
        f"Signals: Trend={sig.get('trend')}, Momentum={sig.get('momentum')}, "
        f"Volume={sig.get('volumeTrend')}, vs SMA={sig.get('priceVsSMA')}"
    )

    fs = analysis.get("floorsheet") or {}
    if fs.get("totalTrades"):
        bt = fs.get("blockTrades") or {}
        total_to = fs.get("totalTurnover") or 1
        block_pct = round((bt.get("turnover") or 0) / max(total_to, 1) * 100, 1)
        data_parts.append(
            f"Floorsheet (7D): {fs['totalTrades']} trades, VWAP=Rs {_f(fs.get('vwap'))}, "
            f"Avg/Median size={_f(fs.get('avgTradeSize'), 0)}/{_f(fs.get('medianTradeSize'), 0)} shares, "
            f"Block trades={bt.get('count', 0)} ({block_pct}% of turnover)"
        )

    config_lines = [f"Analysis horizon: {horizon_label}."]
    if goal_label:
        config_lines.append(goal_label + ".")

    news_block = ""
    if news:
        news_block = f"""
<recent_news>
{json.dumps(news, indent=2)}
</recent_news>
"""

    return f"""You are a NEPSE stock analyst. Provide a data-driven analysis of {symbol} ({analysis.get('name', '')}, sector: {analysis.get('sector', '')}).

{" ".join(config_lines)}

<current_data>
{chr(10).join(data_parts)}
</current_data>
{news_block}
Write a concise analysis in plain text (no markdown, no code fences) with exactly 3 sections:

1. SUMMARY: Two sentences on the stock's current {horizon.replace('_', '-')} technical position and key level to watch.
2. SIGNALS: Two to three specific observations from the selected indicators — what they say about near-term direction given the {'current' if goal == 'neutral' else goal.replace('_', ' ')} perspective.
3. ANOMALIES: Any standout observations — unusual volume, volatility, divergence, news-driven catalysts, or patterns relevant to {horizon.replace('_', ' ')} trading.

Under 200 words total. Be specific with price levels and percentages. Reference any relevant news if it affects the outlook."""


def _build_stock_system_prompt(symbol: str, analysis: dict, news: list | None = None) -> str:
    """Build system message for conversational stock chat."""
    import json
    slim = {k: v for k, v in analysis.items() if k not in ("history", "overlays")}
    news_section = ""
    if news:
        news_section = f"\n\nRecent news about {symbol}:\n{json.dumps(news, indent=2)}\n"
    return f"""You are a NEPSE stock analyst assistant. The user is analyzing {symbol} ({analysis.get('name', '')}, sector: {analysis.get('sector', '')}).

You have the following current market data for this stock:

{json.dumps(slim, indent=2)}
{news_section}
Guidelines:
- Answer directly and specifically using the numbers above
- Under 150 words unless the question genuinely requires more detail
- Plain text only, no markdown formatting
- For buy/sell questions: frame in terms of technical signals and risk levels, not as personal financial advice
- If asked about data not in the context, say so rather than guessing"""


def _get_stock_news(db: Session, symbol: str, hours: int = 72) -> list[dict]:
    """Fetch recent news articles mentioning a specific stock symbol."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    articles = (
        db.query(NewsArticle)
        .filter(
            NewsArticle.published_at >= cutoff,
            NewsArticle.symbols.contains([symbol]),
        )
        .order_by(NewsArticle.published_at.desc())
        .limit(5)
        .all()
    )
    return [
        {"title": a.title, "category": a.category, "published_at": a.published_at.astimezone(NPT).isoformat()}
        for a in articles
    ]


async def generate_stock_insight_text(symbol: str, analysis: dict, options: dict | None = None, db: Session | None = None) -> str:
    """Generate a Claude insight for a specific stock. Returns raw text."""
    if not settings.claude_api_key:
        raise RuntimeError("CLAUDE_API_KEY not configured")

    news = _get_stock_news(db, symbol) if db else []
    prompt = _build_stock_insight_prompt(symbol, analysis, options, news=news)
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.claude_api_key)
        message = client.messages.create(
            model=settings.claude_model_fast,
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text if message.content else ""
        return _strip_code_fences(raw)
    except ImportError:
        raise RuntimeError("anthropic package not installed")


async def stock_chat_turn(symbol: str, analysis: dict, messages: list[dict], db: Session | None = None) -> str:
    """Generate a single conversational reply about a stock."""
    if not settings.claude_api_key:
        raise RuntimeError("CLAUDE_API_KEY not configured")

    news = _get_stock_news(db, symbol) if db else []
    system = _build_stock_system_prompt(symbol, analysis, news=news)
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.claude_api_key)
        message = client.messages.create(
            model=settings.claude_model_fast,
            max_tokens=400,
            system=system,
            messages=messages,
        )
        raw = message.content[0].text if message.content else ""
        return _strip_code_fences(raw)
    except ImportError:
        raise RuntimeError("anthropic package not installed")
