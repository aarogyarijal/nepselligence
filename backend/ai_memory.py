"""AI Memory System — structured knowledge persistence across insight generations.

Every AI insight generation both reads from and writes to the memory layer.
Claude remains stateless per-call, but each call receives curated context
from all previous analyses via assemble_memory_context().
"""

import json
import logging
import re
from datetime import datetime, timezone, timedelta, date

import zoneinfo

NPT = zoneinfo.ZoneInfo("Asia/Kathmandu")

from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text, func

from .config import settings
from .models import (
    AIInsight,
    AIMarketObservation,
    AIPrediction,
    AIPattern,
    AIMarketRegime,
    AIMemorySummary,
    MarketSummary,
    DailySectorIndex,
    StockPrice,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Parsing: extract <memory> JSON block from Claude's raw response
# ---------------------------------------------------------------------------

_MEMORY_RE = re.compile(r"<memory>\s*(.*?)\s*</memory>", re.DOTALL)
_MEMORY_OPEN_RE = re.compile(r"<memory>\s*(.*)", re.DOTALL)


def parse_memory_block(raw_text: str) -> tuple[str, dict | None]:
    """Strip <memory> JSON from insight text. Returns (clean_text, memory_data).

    If no <memory> block is found, returns the original text and None.
    Handles truncated output where </memory> is missing.
    """
    match = _MEMORY_RE.search(raw_text)
    if match:
        json_str = match.group(1).strip()
        clean_text = raw_text[:match.start()].rstrip() + raw_text[match.end():]
        clean_text = clean_text.strip()
    else:
        # Try truncated: <memory> present but no closing tag
        open_match = _MEMORY_OPEN_RE.search(raw_text)
        if not open_match:
            return raw_text, None
        json_str = open_match.group(1).strip()
        clean_text = raw_text[:open_match.start()].rstrip()

    try:
        memory_data = json.loads(json_str)
    except json.JSONDecodeError:
        # Try to repair truncated JSON by closing open braces/brackets
        repaired = _repair_json(json_str)
        if repaired:
            memory_data = repaired
        else:
            logger.warning("Failed to parse <memory> JSON (even after repair attempt)")
            return clean_text, None

    return clean_text, memory_data


def _repair_json(s: str) -> dict | None:
    """Attempt to repair truncated JSON by closing open structures."""
    # Count open braces/brackets
    opens = 0
    open_brackets = 0
    in_string = False
    escape = False
    for ch in s:
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '{':
            opens += 1
        elif ch == '}':
            opens -= 1
        elif ch == '[':
            open_brackets += 1
        elif ch == ']':
            open_brackets -= 1

    if opens <= 0 and open_brackets <= 0:
        return None  # Not a truncation issue

    # Close any open strings, then brackets/braces
    if in_string:
        s += '"'
    s += ']' * open_brackets + '}' * opens

    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# Write: unpack memory JSON into database tables
# ---------------------------------------------------------------------------

def write_memory(
    db: Session,
    insight_id: int,
    memory_data: dict,
    observation_date: date,
) -> None:
    """Unpack parsed memory JSON into observations, predictions, regime, and pattern tables."""
    if not memory_data:
        return

    # --- Observations ---
    for obs in memory_data.get("observations") or []:
        row = AIMarketObservation(
            observation_date=observation_date,
            source_insight_id=insight_id,
            category=obs.get("category", "anomaly"),
            subcategory=obs.get("subcategory"),
            symbol=obs.get("symbol"),
            sector=obs.get("sector"),
            observation=obs.get("text", ""),
            data_snapshot=obs.get("data_snapshot"),
            confidence=obs.get("confidence", "medium"),
            still_relevant=True,
            expires_at=observation_date + timedelta(days=settings.ai_memory_observation_retention_days),
        )
        if row.observation:
            db.add(row)

    # --- Predictions ---
    for pred in memory_data.get("predictions") or []:
        target_days = pred.get("target_days")
        target_dt = observation_date + timedelta(days=target_days) if target_days else None
        row = AIPrediction(
            source_insight_id=insight_id,
            prediction_date=observation_date,
            target_date=target_dt,
            category=pred.get("category", "price_direction"),
            symbol=pred.get("symbol"),
            sector=pred.get("sector"),
            prediction_text=pred.get("text", ""),
            conditions=pred.get("conditions"),
            reference_values=pred.get("reference_values"),
            status="pending",
        )
        if row.prediction_text:
            db.add(row)

    # --- Market Regime ---
    regime = memory_data.get("regime")
    if regime and regime.get("trend"):
        existing = db.query(AIMarketRegime).filter(
            AIMarketRegime.date == observation_date
        ).first()

        # Calculate regime duration by checking previous day
        prev_regime = db.query(AIMarketRegime).filter(
            AIMarketRegime.date < observation_date
        ).order_by(AIMarketRegime.date.desc()).first()

        duration = 1
        if prev_regime and prev_regime.trend == regime.get("trend"):
            duration = (prev_regime.regime_duration_days or 0) + 1

        if existing:
            existing.trend = regime["trend"]
            existing.trend_strength = regime.get("trend_strength")
            existing.volatility_regime = regime.get("volatility")
            existing.breadth_health = regime.get("breadth_health")
            existing.leading_sectors = regime.get("leading_sectors", [])
            existing.lagging_sectors = regime.get("lagging_sectors", [])
            existing.key_levels = regime.get("key_levels")
            existing.regime_duration_days = duration
            existing.notes = regime.get("notes")
            # Update index from latest market summary
            latest_summary = db.query(MarketSummary).order_by(MarketSummary.time.desc()).first()
            if latest_summary:
                existing.nepse_index = latest_summary.nepse_index
        else:
            latest_summary = db.query(MarketSummary).order_by(MarketSummary.time.desc()).first()
            row = AIMarketRegime(
                date=observation_date,
                trend=regime["trend"],
                trend_strength=regime.get("trend_strength"),
                volatility_regime=regime.get("volatility"),
                breadth_health=regime.get("breadth_health"),
                leading_sectors=regime.get("leading_sectors", []),
                lagging_sectors=regime.get("lagging_sectors", []),
                nepse_index=latest_summary.nepse_index if latest_summary else None,
                key_levels=regime.get("key_levels"),
                regime_duration_days=duration,
                notes=regime.get("notes"),
            )
            db.add(row)

    # --- Patterns ---
    for pat in memory_data.get("patterns") or []:
        action = pat.get("action", "new")
        if action == "reinforce" and (pat.get("pattern_id") or pat.get("name")):
            # Look up by integer ID or by name (AI may generate string slugs)
            pid = pat.get("pattern_id")
            if isinstance(pid, int):
                existing = db.query(AIPattern).filter(AIPattern.id == pid).first()
            else:
                # Fall back to name-based lookup
                lookup_name = pat.get("name") or str(pid)
                existing = db.query(AIPattern).filter(AIPattern.pattern_name == lookup_name).first()
            if existing:
                existing.evidence_count = (existing.evidence_count or 0) + 1
                existing.last_observed = observation_date
        elif action == "new" and pat.get("name"):
            row = AIPattern(
                pattern_name=pat["name"],
                description=pat.get("description", ""),
                category=pat.get("category", "momentum"),
                conditions=pat.get("conditions"),
                evidence_count=1,
                last_observed=observation_date,
                status="hypothesis",
            )
            db.add(row)

    # Do NOT commit here — let the caller handle the transaction
    db.flush()


# ---------------------------------------------------------------------------
# Read: assemble memory context for prompt injection
# ---------------------------------------------------------------------------

def assemble_memory_context(
    db: Session,
    insight_type: str,
    symbol: str | None = None,
) -> str:
    """Query memory tables and return a plain-text context block for prompt injection.

    Sized appropriately for each insight type's token budget.
    """
    parts: list[str] = []
    today = date.today()

    # --- Market Regime ---
    regime = db.query(AIMarketRegime).order_by(AIMarketRegime.date.desc()).first()
    if regime:
        leading = ", ".join(regime.leading_sectors or []) or "none identified"
        lagging = ", ".join(regime.lagging_sectors or []) or "none identified"
        levels = regime.key_levels or {}
        levels_str = ", ".join(f"{k}: {v}" for k, v in levels.items()) if levels else "not set"
        parts.append(
            f"[MARKET REGIME] {regime.trend.capitalize()} (day {regime.regime_duration_days}), "
            f"{regime.trend_strength or 'moderate'} strength, "
            f"volatility {regime.volatility_regime or 'normal'}, "
            f"breadth {regime.breadth_health or 'unknown'}.\n"
            f"Leading: {leading}. Lagging: {lagging}.\n"
            f"Key levels: {levels_str}."
        )

    # --- Observations (scope depends on insight type) ---
    if insight_type == "hourly":
        # Today's earlier observations only
        obs = db.query(AIMarketObservation).filter(
            AIMarketObservation.observation_date == today,
            AIMarketObservation.still_relevant == True,
        ).order_by(AIMarketObservation.created_at.asc()).limit(5).all()
    elif insight_type == "market_open":
        # Yesterday's close observations + this week so far
        week_start = today - timedelta(days=today.weekday())  # Monday
        obs = db.query(AIMarketObservation).filter(
            AIMarketObservation.observation_date >= week_start,
            AIMarketObservation.observation_date < today,
            AIMarketObservation.still_relevant == True,
        ).order_by(AIMarketObservation.created_at.desc()).limit(5).all()
        obs = list(reversed(obs))
    elif insight_type == "daily_close":
        # Full day + this week
        week_start = today - timedelta(days=today.weekday())
        obs = db.query(AIMarketObservation).filter(
            AIMarketObservation.observation_date >= week_start,
            AIMarketObservation.still_relevant == True,
        ).order_by(AIMarketObservation.created_at.desc()).limit(15).all()
        obs = list(reversed(obs))
    elif insight_type == "weekly_wrap":
        # Full week + prior observations
        week_start = today - timedelta(days=7)
        obs = db.query(AIMarketObservation).filter(
            AIMarketObservation.observation_date >= week_start,
            AIMarketObservation.still_relevant == True,
        ).order_by(AIMarketObservation.created_at.desc()).limit(20).all()
        obs = list(reversed(obs))
    elif insight_type == "stock_insight" and symbol:
        # Stock-specific + sector context
        obs_stock = db.query(AIMarketObservation).filter(
            AIMarketObservation.symbol == symbol,
            AIMarketObservation.still_relevant == True,
        ).order_by(AIMarketObservation.created_at.desc()).limit(3).all()
        obs_sector = db.query(AIMarketObservation).filter(
            AIMarketObservation.category == "sector",
            AIMarketObservation.observation_date >= today - timedelta(days=5),
            AIMarketObservation.still_relevant == True,
        ).order_by(AIMarketObservation.created_at.desc()).limit(3).all()
        obs = list(reversed(obs_stock)) + list(reversed(obs_sector))
    else:
        obs = []

    if obs:
        obs_lines = []
        for o in obs:
            date_str = o.observation_date.strftime("%a") if o.observation_date else ""
            prefix = f"{date_str}: " if date_str else ""
            obs_lines.append(f"- {prefix}{o.observation}")
        parts.append("[RECENT OBSERVATIONS]\n" + "\n".join(obs_lines))

    # --- Pending Predictions ---
    pred_query = db.query(AIPrediction).filter(AIPrediction.status == "pending")
    if insight_type == "stock_insight" and symbol:
        pred_query = pred_query.filter(AIPrediction.symbol == symbol)
    elif insight_type in ("market_open", "hourly"):
        pred_query = pred_query.filter(
            AIPrediction.prediction_date >= today - timedelta(days=7)
        )
    else:
        pred_query = pred_query.filter(
            AIPrediction.prediction_date >= today - timedelta(days=14)
        )

    pending = pred_query.order_by(AIPrediction.prediction_date.desc()).limit(8).all()
    if pending:
        pred_lines = []
        for p in pending:
            made_date = p.prediction_date.strftime("%a %b %d") if p.prediction_date else ""
            # Check if target_date has passed — mark as CHECK vs MONITOR
            label = "CHECK" if p.target_date and p.target_date <= today else "MONITOR"
            pred_lines.append(f'- "{p.prediction_text}" (made {made_date}) -> {label}')
        parts.append("[PENDING PREDICTIONS]\n" + "\n".join(pred_lines))

    # --- Active Patterns (daily_close and weekly_wrap only) ---
    if insight_type in ("daily_close", "weekly_wrap"):
        patterns = db.query(AIPattern).filter(
            AIPattern.status.in_(["emerging", "established", "hypothesis"])
        ).order_by(
            # Prefer established > emerging > hypothesis
            AIPattern.status.desc(),
            AIPattern.evidence_count.desc(),
        ).limit(5).all()
        if patterns:
            pat_lines = []
            for p in patterns:
                conf_rate = f"{p.confirmation_count}/{p.evidence_count}" if p.evidence_count else "0/0"
                pat_lines.append(f'- "{p.pattern_name}" ({p.status}, confirmed {conf_rate})')
            parts.append("[ACTIVE PATTERNS]\n" + "\n".join(pat_lines))

    # --- Prediction Scorecard (weekly_wrap only) ---
    if insight_type == "weekly_wrap":
        scorecard = get_prediction_scorecard(db, days=30)
        if scorecard["total"] > 0:
            parts.append(
                f"[PREDICTION TRACK RECORD]\n"
                f"Last 30 days: {scorecard['confirmed']} confirmed / "
                f"{scorecard['invalidated']} invalidated / "
                f"{scorecard['expired']} expired = "
                f"{scorecard['hit_rate_pct']:.0f}% hit rate"
            )

    # --- Weekly/Monthly Summaries (daily_close + weekly_wrap) ---
    if insight_type == "daily_close":
        last_weekly = db.query(AIMemorySummary).filter(
            AIMemorySummary.period_type == "weekly"
        ).order_by(AIMemorySummary.period_end.desc()).first()
        if last_weekly:
            parts.append(f"[LAST WEEK SUMMARY ({last_weekly.period_start} to {last_weekly.period_end})]\n{last_weekly.summary_text}")

    elif insight_type == "weekly_wrap":
        # Last 4 weekly summaries
        weekly_summaries = db.query(AIMemorySummary).filter(
            AIMemorySummary.period_type == "weekly"
        ).order_by(AIMemorySummary.period_end.desc()).limit(4).all()
        if weekly_summaries:
            for ws in reversed(weekly_summaries):
                parts.append(
                    f"[WEEK {ws.period_start} to {ws.period_end}]\n{ws.summary_text}"
                )

        last_monthly = db.query(AIMemorySummary).filter(
            AIMemorySummary.period_type == "monthly"
        ).order_by(AIMemorySummary.period_end.desc()).first()
        if last_monthly:
            parts.append(
                f"[LAST MONTH SUMMARY ({last_monthly.period_start} to {last_monthly.period_end})]\n{last_monthly.summary_text}"
            )

    if not parts:
        return ""

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Prediction Resolution
# ---------------------------------------------------------------------------

def _fetch_current_value(db: Session, metric: str, symbol: str | None) -> float | None:
    """Fetch a current metric value for prediction checking."""
    if metric == "nepse_index":
        row = db.query(MarketSummary).order_by(MarketSummary.time.desc()).first()
        return row.nepse_index if row else None

    if metric in ("price", "ltp") and symbol:
        row = db.query(StockPrice).filter(
            StockPrice.symbol == symbol
        ).order_by(StockPrice.time.desc()).first()
        return row.ltp if row else None

    if metric == "change_pct" and symbol:
        row = db.query(StockPrice).filter(
            StockPrice.symbol == symbol
        ).order_by(StockPrice.time.desc()).first()
        return row.change_percent if row else None

    if metric == "sector_change_pct":
        # Would need sector name from conditions — skip for now
        return None

    # For technical indicators (rsi, macd, etc.), we'd need to compute them.
    # That's expensive per-prediction; handled in batch by the AI resolution prompt.
    return None


def get_prediction_scorecard(db: Session, days: int = 30) -> dict:
    """Compute prediction hit rate over the last N days."""
    cutoff = date.today() - timedelta(days=days)
    resolved = db.query(AIPrediction).filter(
        AIPrediction.resolved_at != None,
        AIPrediction.prediction_date >= cutoff,
    ).all()

    total = len(resolved)
    confirmed = sum(1 for p in resolved if p.status == "confirmed")
    partial = sum(1 for p in resolved if p.status == "partially_confirmed")
    invalidated = sum(1 for p in resolved if p.status == "invalidated")
    expired = sum(1 for p in resolved if p.status == "expired")
    hit_rate = (confirmed + partial * 0.5) / total * 100 if total > 0 else 0

    return {
        "total": total,
        "confirmed": confirmed,
        "partially_confirmed": partial,
        "invalidated": invalidated,
        "expired": expired,
        "hit_rate_pct": hit_rate,
    }


async def resolve_pending_predictions(db: Session, provider_manager=None) -> list[dict]:
    """Check pending predictions against current data and resolve via Claude batch call.

    Runs before daily_close generation to update prediction statuses.
    Returns list of resolution dicts for injection into the insight prompt.
    """
    today = date.today()

    # Find predictions due for resolution (target_date passed or within 1 day)
    pending = db.query(AIPrediction).filter(
        AIPrediction.status == "pending",
        AIPrediction.target_date != None,
        AIPrediction.target_date <= today + timedelta(days=1),
    ).order_by(AIPrediction.prediction_date.asc()).limit(10).all()

    if not pending:
        return []

    # Build context for each prediction
    resolution_items = []
    for pred in pending:
        current_vals = {}
        if pred.conditions and isinstance(pred.conditions, dict):
            metric = pred.conditions.get("metric")
            sym = pred.conditions.get("symbol") or pred.symbol
            val = _fetch_current_value(db, metric, sym) if metric else None
            if val is not None:
                current_vals[metric] = val

        # Also fetch basic price if symbol exists
        if pred.symbol:
            price = _fetch_current_value(db, "price", pred.symbol)
            pct = _fetch_current_value(db, "change_pct", pred.symbol)
            if price is not None:
                current_vals["price"] = price
            if pct is not None:
                current_vals["change_pct"] = pct

        # NEPSE index for market-level predictions
        if not pred.symbol:
            idx = _fetch_current_value(db, "nepse_index", None)
            if idx is not None:
                current_vals["nepse_index"] = idx

        resolution_items.append({
            "id": pred.id,
            "text": pred.prediction_text,
            "made": str(pred.prediction_date),
            "target": str(pred.target_date) if pred.target_date else "open",
            "reference": pred.reference_values or {},
            "current": current_vals,
        })

    if not resolution_items:
        return []

    # Call Claude haiku to assess predictions in batch
    if not settings.claude_api_key:
        logger.info("No CLAUDE_API_KEY, skipping prediction resolution")
        return []

    prompt = f"""You are evaluating past market predictions against current data.

For each prediction below, assess whether it was confirmed, invalidated, partially_confirmed, or should remain pending.

<predictions>
{json.dumps(resolution_items, indent=2)}
</predictions>

Return a JSON array with one object per prediction:
[{{"id": <prediction_id>, "status": "confirmed|invalidated|partially_confirmed|expired", "explanation": "one sentence"}}]

Rules:
- "confirmed": the predicted outcome clearly occurred
- "partially_confirmed": the direction was right but magnitude was off, or it partially played out
- "invalidated": the opposite occurred or conditions moved against the prediction
- "expired": target date passed with no clear resolution either way
- If you cannot determine from the data provided, use "expired"

Return ONLY the JSON array, no other text."""

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.claude_api_key)
        message = client.messages.create(
            model=settings.claude_model_fast,
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text if message.content else "[]"
        # Strip code fences if present
        raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw)
        resolutions = json.loads(raw)
    except Exception as e:
        logger.error(f"Prediction resolution API call failed: {e}")
        return []

    # Apply resolutions to database
    results = []
    pred_map = {p.id: p for p in pending}
    for res in resolutions:
        pred_id = res.get("id")
        pred = pred_map.get(pred_id)
        if not pred:
            continue

        new_status = res.get("status", "expired")
        if new_status not in ("confirmed", "invalidated", "partially_confirmed", "expired"):
            new_status = "expired"

        pred.status = new_status
        pred.resolution_text = res.get("explanation", "")
        pred.resolved_at = datetime.now(timezone.utc)
        # Store current values as outcome
        matching_item = next((i for i in resolution_items if i["id"] == pred_id), None)
        if matching_item:
            pred.outcome_values = matching_item["current"]

        results.append({
            "prediction": pred.prediction_text,
            "status": new_status,
            "explanation": res.get("explanation", ""),
        })

    try:
        db.commit()
        logger.info(f"Resolved {len(results)} predictions")
    except Exception as e:
        logger.error(f"Failed to save prediction resolutions: {e}")
        db.rollback()

    return results


# ---------------------------------------------------------------------------
# Summarization: compress old memory into weekly/monthly digests
# ---------------------------------------------------------------------------

async def generate_weekly_summary(db: Session, provider_manager=None) -> None:
    """Compress the past week's observations into a weekly summary.

    Marks old observations as still_relevant=FALSE after summarization.
    """
    if not settings.claude_api_key:
        return

    today = date.today()
    # Find the week to summarize (previous full week)
    # Go back to last Sunday as period_end, previous Sunday as period_start
    days_since_sunday = (today.weekday() + 1) % 7
    period_end = today - timedelta(days=days_since_sunday)
    period_start = period_end - timedelta(days=6)

    # Check if already summarized
    existing = db.query(AIMemorySummary).filter(
        AIMemorySummary.period_type == "weekly",
        AIMemorySummary.period_start == period_start,
    ).first()
    if existing:
        logger.info(f"Weekly summary already exists for {period_start}")
        return

    # Gather the week's observations
    observations = db.query(AIMarketObservation).filter(
        AIMarketObservation.observation_date >= period_start,
        AIMarketObservation.observation_date <= period_end,
    ).order_by(AIMarketObservation.created_at.asc()).all()

    # Gather the week's resolved predictions
    resolved = db.query(AIPrediction).filter(
        AIPrediction.resolved_at != None,
        AIPrediction.prediction_date >= period_start,
        AIPrediction.prediction_date <= period_end,
    ).all()

    # Gather regime history
    regimes = db.query(AIMarketRegime).filter(
        AIMarketRegime.date >= period_start,
        AIMarketRegime.date <= period_end,
    ).order_by(AIMarketRegime.date.asc()).all()

    obs_text = "\n".join(
        f"- {o.observation_date} [{o.category}]: {o.observation}"
        for o in observations
    ) or "No observations recorded."

    pred_text = "\n".join(
        f"- {p.prediction_text} -> {p.status}: {p.resolution_text or 'no detail'}"
        for p in resolved
    ) or "No predictions resolved."

    regime_text = "\n".join(
        f"- {r.date}: {r.trend} ({r.trend_strength}), vol={r.volatility_regime}, breadth={r.breadth_health}"
        for r in regimes
    ) or "No regime data."

    prompt = f"""Summarize this week's NEPSE market activity into a concise weekly digest (under 200 words).

<observations>
{obs_text}
</observations>

<resolved_predictions>
{pred_text}
</resolved_predictions>

<market_regime>
{regime_text}
</market_regime>

Write a plain text summary covering:
1. Overall market trajectory and key levels
2. Standout sectors and stocks
3. Notable events or anomalies
4. Prediction accuracy summary

Be specific with numbers. No markdown. No section headers — write it as a cohesive paragraph or two."""

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.claude_api_key)
        message = client.messages.create(
            model=settings.claude_model_fast,
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}],
        )
        summary_text = message.content[0].text.strip() if message.content else ""
    except Exception as e:
        logger.error(f"Weekly summary generation failed: {e}")
        return

    if not summary_text:
        return

    # Build scorecard for the period
    total = len(resolved)
    confirmed = sum(1 for p in resolved if p.status == "confirmed")
    invalidated = sum(1 for p in resolved if p.status == "invalidated")
    expired = sum(1 for p in resolved if p.status == "expired")

    # Gather sector performance for the period
    sector_perf = db.query(
        DailySectorIndex.sector_name,
        func.sum(DailySectorIndex.change_pct).label("total_change_pct"),
    ).filter(
        DailySectorIndex.date >= period_start,
        DailySectorIndex.date <= period_end,
    ).group_by(DailySectorIndex.sector_name).all()

    sector_data = {s.sector_name: round(s.total_change_pct or 0, 2) for s in sector_perf}

    summary = AIMemorySummary(
        period_type="weekly",
        period_start=period_start,
        period_end=period_end,
        summary_text=summary_text,
        key_events=[o.observation for o in observations[:5]],  # Top 5 observations
        prediction_scorecard={
            "total": total,
            "confirmed": confirmed,
            "invalidated": invalidated,
            "expired": expired,
        },
        market_regime_summary={
            "dominant_trend": regimes[-1].trend if regimes else "unknown",
            "days": len(regimes),
        },
        sector_performance=sector_data,
        notable_stocks=list({o.symbol for o in observations if o.symbol}),
    )
    db.add(summary)

    # Mark old observations as no longer relevant
    db.query(AIMarketObservation).filter(
        AIMarketObservation.observation_date <= period_end,
        AIMarketObservation.still_relevant == True,
    ).update({"still_relevant": False})

    try:
        db.commit()
        logger.info(f"Weekly summary generated for {period_start} to {period_end}")
    except Exception as e:
        logger.error(f"Failed to save weekly summary: {e}")
        db.rollback()


async def generate_monthly_summary(db: Session, provider_manager=None) -> None:
    """Compress weekly summaries into a monthly digest."""
    if not settings.claude_api_key:
        return

    today = date.today()
    # Summarize the previous month
    if today.month == 1:
        period_start = date(today.year - 1, 12, 1)
    else:
        period_start = date(today.year, today.month - 1, 1)
    period_end = date(today.year, today.month, 1) - timedelta(days=1)

    existing = db.query(AIMemorySummary).filter(
        AIMemorySummary.period_type == "monthly",
        AIMemorySummary.period_start == period_start,
    ).first()
    if existing:
        logger.info(f"Monthly summary already exists for {period_start}")
        return

    # Gather weekly summaries from that month
    weekly = db.query(AIMemorySummary).filter(
        AIMemorySummary.period_type == "weekly",
        AIMemorySummary.period_start >= period_start,
        AIMemorySummary.period_end <= period_end,
    ).order_by(AIMemorySummary.period_start.asc()).all()

    if not weekly:
        logger.info("No weekly summaries to compress into monthly")
        return

    weeks_text = "\n\n".join(
        f"Week {w.period_start} to {w.period_end}:\n{w.summary_text}"
        for w in weekly
    )

    # Aggregate scorecards
    total_preds = sum(
        (w.prediction_scorecard or {}).get("total", 0) for w in weekly
    )
    total_confirmed = sum(
        (w.prediction_scorecard or {}).get("confirmed", 0) for w in weekly
    )

    prompt = f"""Summarize this month's NEPSE market activity into a concise monthly digest (under 300 words).

<weekly_summaries>
{weeks_text}
</weekly_summaries>

Prediction scorecard for the month: {total_confirmed}/{total_preds} confirmed.

Write a plain text summary covering:
1. Monthly market trajectory — opening vs closing NEPSE levels, net change
2. Key themes and trends that defined the month
3. Sector rotation patterns
4. Notable stocks and events
5. Prediction accuracy trends

Be analytical, not just descriptive. No markdown."""

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.claude_api_key)
        message = client.messages.create(
            model=settings.claude_model_fast,
            max_tokens=700,
            messages=[{"role": "user", "content": prompt}],
        )
        summary_text = message.content[0].text.strip() if message.content else ""
    except Exception as e:
        logger.error(f"Monthly summary generation failed: {e}")
        return

    if not summary_text:
        return

    summary = AIMemorySummary(
        period_type="monthly",
        period_start=period_start,
        period_end=period_end,
        summary_text=summary_text,
        prediction_scorecard={
            "total": total_preds,
            "confirmed": total_confirmed,
        },
    )
    db.add(summary)

    try:
        db.commit()
        logger.info(f"Monthly summary generated for {period_start} to {period_end}")
    except Exception as e:
        logger.error(f"Failed to save monthly summary: {e}")
        db.rollback()


# ---------------------------------------------------------------------------
# Cleanup: expire old memory
# ---------------------------------------------------------------------------

def cleanup_expired_memory(db: Session) -> int:
    """Mark old observations as not relevant, expire overdue predictions.

    Returns total number of rows affected.
    """
    today = date.today()
    affected = 0

    # Expire observations past their expiry date
    count = db.query(AIMarketObservation).filter(
        AIMarketObservation.expires_at != None,
        AIMarketObservation.expires_at <= today,
        AIMarketObservation.still_relevant == True,
    ).update({"still_relevant": False})
    affected += count

    # Expire overdue predictions (target_date passed by > 3 days with no resolution)
    overdue_cutoff = today - timedelta(days=3)
    expired_preds = db.query(AIPrediction).filter(
        AIPrediction.status == "pending",
        AIPrediction.target_date != None,
        AIPrediction.target_date <= overdue_cutoff,
    ).all()
    for p in expired_preds:
        p.status = "expired"
        p.resolved_at = datetime.now(timezone.utc)
        p.resolution_text = "Auto-expired: target date passed without resolution."
    affected += len(expired_preds)

    # Delete very old weekly summaries (beyond retention)
    weekly_cutoff = today - timedelta(weeks=settings.ai_memory_weekly_summary_retention_weeks)
    count = db.query(AIMemorySummary).filter(
        AIMemorySummary.period_type == "weekly",
        AIMemorySummary.period_end <= weekly_cutoff,
    ).delete()
    affected += count

    # Delete old regime rows
    regime_cutoff = today - timedelta(days=settings.ai_memory_regime_retention_days)
    count = db.query(AIMarketRegime).filter(
        AIMarketRegime.date <= regime_cutoff,
    ).delete()
    affected += count

    try:
        db.commit()
        logger.info(f"Memory cleanup: {affected} rows affected")
    except Exception as e:
        logger.error(f"Memory cleanup failed: {e}")
        db.rollback()

    return affected


# ---------------------------------------------------------------------------
# Memory extraction instruction for prompts
# ---------------------------------------------------------------------------

MEMORY_EXTRACTION_INSTRUCTION = """

After your analysis, append a JSON block wrapped in <memory> tags containing your structured observations from this analysis. This is critical for building market understanding over time.

<memory>
{
  "observations": [
    {"category": "market_regime|sector|stock|breadth|anomaly", "subcategory": "optional_detail", "symbol": null, "sector": null, "text": "One-sentence factual observation with specific numbers", "confidence": "low|medium|high", "data_snapshot": {"key_metric": value}}
  ],
  "predictions": [
    {"category": "price_direction|sector_rotation|breakout|support_test", "symbol": null, "sector": null, "text": "Specific forward-looking statement", "conditions": {"metric": "rsi|price|nepse_index|change_pct", "symbol": "SYMBOL", "direction": "above|below", "threshold": 60}, "reference_values": {"price": 1250, "rsi": 72}, "target_days": 5}
  ],
  "regime": {
    "trend": "bullish|bearish|sideways|transitioning",
    "trend_strength": "weak|moderate|strong",
    "volatility": "low|normal|elevated|extreme",
    "breadth_health": "healthy|narrowing|weak|divergent",
    "leading_sectors": ["Banking", "Hydropower"],
    "lagging_sectors": ["Hotels", "Trading"],
    "key_levels": {"support": 2380, "resistance": 2500}
  },
  "patterns": [
    {"name": "Short descriptive name", "description": "Full pattern hypothesis", "category": "sector_rotation|momentum|seasonal|volume|correlation", "action": "new|reinforce", "pattern_id": null}
  ]
}
</memory>

Guidelines for memory extraction:
- observations: 2-5 per analysis. Be specific with numbers. Focus on what changed or stands out.
- predictions: 0-3 per analysis. Only make predictions you'd want tracked. Include measurable conditions where possible.
- regime: Always include. Assess the overall market state honestly.
- patterns: Only when you notice a recurring behavior. Use "reinforce" with the exact pattern "name" if you see a previously identified pattern repeating (pattern_id should always be null).
- Do NOT fabricate observations — only record what the data shows."""
