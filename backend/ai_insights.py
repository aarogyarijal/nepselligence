"""Claude API integration for generating NEPSE market insights."""

import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .config import settings
from .models import AIInsight, MarketSummary, StockPrice

logger = logging.getLogger(__name__)


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences if Claude wraps JSON in them."""
    text = text.strip()
    # Strip ```json ... ``` or ``` ... ```
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _build_prompt(summary: MarketSummary, gainers: list, losers: list) -> str:
    market_data = {
        "nepse_index": summary.nepse_index,
        "nepse_change": summary.nepse_change,
        "nepse_change_pct": summary.nepse_change_pct,
        "total_turnover": summary.total_turnover,
        "total_shares": summary.total_shares,
        "total_transactions": summary.total_transactions,
        "as_of": summary.time.isoformat(),
        "top_gainers": [
            {"symbol": s.symbol, "ltp": s.ltp, "change_pct": s.change_percent}
            for s in gainers
        ],
        "top_losers": [
            {"symbol": s.symbol, "ltp": s.ltp, "change_pct": s.change_percent}
            for s in losers
        ],
    }

    return f"""You are a NEPSE market analyst. Analyze the following market data and provide a concise daily summary.

<market_data>
{json.dumps(market_data, indent=2)}
</market_data>

Respond in plain text (no markdown, no code fences) with exactly 3 short sections:

1. SUMMARY: One sentence on overall market direction and NEPSE index movement.
2. SIGNALS: Two to three notable stocks (gainers or losers) worth watching and why.
3. ANOMALIES: Any unusual activity (abnormal volume, large swings, sector concentration).

Keep the entire response under 200 words. Be factual, not speculative."""


async def generate_market_insight(db: Session, provider_manager) -> None:
    """Generate and store a Claude market insight. Skips if no data or no API key."""
    if not settings.claude_api_key:
        logger.info("No CLAUDE_API_KEY configured, skipping AI insight generation")
        return

    # Get latest market summary
    summary = db.query(MarketSummary).order_by(MarketSummary.time.desc()).first()
    if not summary:
        logger.info("No market summary data available, skipping AI insight")
        return

    # Get top 5 gainers and losers from latest prices
    from sqlalchemy import text as sql_text
    latest_prices = db.execute(
        sql_text("""
            SELECT DISTINCT ON (symbol) symbol, ltp, change_percent, time
            FROM stock_prices
            ORDER BY symbol, time DESC
        """)
    ).fetchall()

    if not latest_prices:
        logger.info("No stock price data available, skipping AI insight")
        return

    # Sort by change_percent
    sorted_prices = sorted(
        [r for r in latest_prices if r.change_percent is not None],
        key=lambda r: r.change_percent,
        reverse=True,
    )
    gainers = sorted_prices[:5]
    losers = sorted_prices[-5:][::-1]

    # Build simple objects for the prompt
    class PriceObj:
        def __init__(self, row):
            self.symbol = row.symbol
            self.ltp = row.ltp
            self.change_percent = row.change_percent

    prompt = _build_prompt(summary, [PriceObj(r) for r in gainers], [PriceObj(r) for r in losers])

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.claude_api_key)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
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
            insight_text=insight_text[:2000],  # column max
            symbol=None,
            extra_data={
                "nepse_index": summary.nepse_index,
                "nepse_change_pct": summary.nepse_change_pct,
                "model": "claude-haiku-4-5-20251001",
            },
        )
        db.add(insight)
        db.commit()
        logger.info("AI insight generated and stored")

    except ImportError:
        logger.error("anthropic package not installed. Run: pip install anthropic")
    except Exception as e:
        logger.error(f"Claude API call failed: {e}")
        db.rollback()
