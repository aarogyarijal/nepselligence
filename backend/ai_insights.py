"""Claude API integration for generating NEPSE market insights."""

import json
import logging
import re
from datetime import datetime, timezone, timedelta, date

from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from .config import settings
from .models import AIInsight, MarketSummary, DailySectorIndex, DailyMarketBreadth

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
            "as_of": summary.time.isoformat(),
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


def _build_open_prompt(ctx: dict) -> str:
    return f"""You are a NEPSE market analyst. The Nepal Stock Exchange (NEPSE) has just opened for trading.

<market_data>
{json.dumps(ctx, indent=2)}
</market_data>

Write a concise morning market briefing in plain text (no markdown, no code fences) with exactly 3 sections:

1. SUMMARY: One sentence on the opening context — yesterday's close, index level, and initial market tone.
2. SIGNALS: Two to three stocks or sectors worth watching today based on recent momentum.
3. ANOMALIES: Any pre-market observations or risks to watch (high breadth imbalance, sector weakness, etc.).

Keep the total under 180 words. Be factual and specific."""


def _build_hourly_prompt(ctx: dict) -> str:
    return f"""You are a NEPSE market analyst providing a mid-session update.

<market_data>
{json.dumps(ctx, indent=2)}
</market_data>

Write a concise mid-session update in plain text (no markdown, no code fences) with exactly 3 sections:

1. SUMMARY: One sentence on current market direction — NEPSE level, change, and intraday breadth.
2. SIGNALS: Two stocks showing notable intraday strength or weakness and why they stand out.
3. ANOMALIES: Any unusual activity — sector rotation, volume spikes, or breadth extremes.

Keep the total under 180 words. Be specific about numbers (index level, % changes)."""


def _build_close_prompt(ctx: dict, day_insights: list[str]) -> str:
    prior = "\n\n".join(day_insights) if day_insights else "No earlier insights today."
    return f"""You are a NEPSE market analyst writing the end-of-day market summary.

<market_data>
{json.dumps(ctx, indent=2)}
</market_data>

<earlier_insights_today>
{prior}
</earlier_insights_today>

Write a thorough end-of-day analysis in plain text (no markdown, no code fences) with exactly 3 sections:

1. SUMMARY: Two to three sentences summarizing the full trading session — final NEPSE level, overall direction, turnover, and market breadth conclusion.
2. SIGNALS: Three to four stocks worth monitoring tomorrow based on today's close — include price levels and reasons.
3. ANOMALIES: Notable events from today's session — sector concentration, unusual volumes, large swings, or breadth extremes that could affect tomorrow.

Keep the total under 280 words. Reference the earlier intraday insights where relevant to show progression."""


def _build_weekly_prompt(ctx: dict, week_data: list[dict]) -> str:
    return f"""You are a NEPSE market analyst writing the weekly market wrap.

<this_week_data>
{json.dumps(week_data, indent=2)}
</this_week_data>

<latest_session>
{json.dumps(ctx, indent=2)}
</latest_session>

Write a weekly market wrap in plain text (no markdown, no code fences) with exactly 3 sections:

1. SUMMARY: Two to three sentences on the week's overall performance — net NEPSE change, high/low range, and total turnover trajectory.
2. SIGNALS: Three stocks or sectors that defined the week — both leaders and laggards with context.
3. ANOMALIES: Any week-level themes worth watching next week — trends, reversals, volume patterns, or macro signals.

Keep the total under 300 words. Be analytical, not just descriptive."""


async def generate_insight(db: Session, provider_manager, insight_type: str) -> None:
    """Generate and store a Claude insight of the specified type. Skips if no API key."""
    if not settings.claude_api_key:
        logger.info("No CLAUDE_API_KEY configured, skipping AI insight generation")
        return

    ctx = _gather_market_context(db)
    if not ctx.get("index"):
        logger.info("No market data available, skipping AI insight")
        return

    # Pick prompt and model based on type
    if insight_type == MARKET_OPEN:
        prompt = _build_open_prompt(ctx)
        model = settings.claude_model_fast
    elif insight_type == HOURLY:
        prompt = _build_hourly_prompt(ctx)
        model = settings.claude_model_fast
    elif insight_type == WEEKLY_WRAP:
        week_data = _gather_week_context(db)
        prompt = _build_weekly_prompt(ctx, week_data)
        model = settings.claude_model_deep
    else:  # DAILY_CLOSE (default)
        today = date.today()
        today_insights = db.query(AIInsight).filter(
            AIInsight.generated_at >= datetime.now(timezone.utc).replace(hour=0, minute=0, second=0),
            AIInsight.insight_type.in_([MARKET_OPEN, HOURLY]),
        ).order_by(AIInsight.generated_at.asc()).all()
        day_texts = [i.insight_text for i in today_insights]
        prompt = _build_close_prompt(ctx, day_texts)
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
