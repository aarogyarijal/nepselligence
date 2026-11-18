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
from .memory_parsing import parse_memory_block, split_response  # noqa: F401  (re-exported)
from .prediction_grading import (
    PREDICTION_GRACE_DAYS,
    describe,
    grade,
    normalize_condition,
    pattern_status,
    pattern_test_outcome,
    summarize,
    valid_target_days,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Write: unpack memory JSON into database tables
# ---------------------------------------------------------------------------

def _find_pattern(db: Session, name: str) -> AIPattern | None:
    """Look a pattern up by name, ignoring case. Retired patterns are not reused."""
    return db.query(AIPattern).filter(
        func.lower(AIPattern.pattern_name) == name.strip().lower(),
        AIPattern.status != "invalidated",
    ).order_by(AIPattern.id.asc()).first()


def update_pattern_from_tests(db: Session, pattern: AIPattern) -> None:
    """Recompute a pattern's track record and status from the graded predictions linked to it."""
    db.flush()
    graded = db.query(AIPrediction).filter(
        AIPrediction.pattern_id == pattern.id,
        AIPrediction.status.in_(["confirmed", "invalidated"]),
    ).all()
    outcomes = [
        (p, pattern_test_outcome(p.status, (p.outcome_values or {}).get("baseline_correct")))
        for p in graded
    ]
    wins = [p for p, outcome in outcomes if outcome is True]
    tests = sum(1 for _, outcome in outcomes if outcome is not None)

    pattern.test_count = tests
    pattern.confirmation_count = len(wins)
    if wins:
        pattern.last_confirmed = max(p.target_date for p in wins)
    new_status = pattern_status(len(wins), tests)
    if new_status != pattern.status:
        logger.info(
            f"Pattern {pattern.pattern_name!r}: {pattern.status} -> {new_status} "
            f"({len(wins)}/{tests} tests right)"
        )
        pattern.status = new_status


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

    # --- Patterns (before predictions, so predictions can link to them) ---
    patterns_by_name: dict[str, AIPattern] = {}
    for pat in memory_data.get("patterns") or []:
        name = (pat.get("name") or "").strip()
        if not name:
            continue
        existing = patterns_by_name.get(name.lower()) or _find_pattern(db, name)
        if existing is None and pat.get("action") == "reinforce":
            # Reinforcing a name that does not exist would mint a near-duplicate
            logger.info(f"Ignored reinforce of unknown pattern {name!r}")
            continue
        if existing:
            # "new" under a name that already exists is a repeat sighting
            existing.evidence_count = (existing.evidence_count or 0) + 1
            existing.last_observed = observation_date
        else:
            existing = AIPattern(
                pattern_name=name,
                description=pat.get("description") or "",
                category=pat.get("category") or "momentum",
                conditions=pat.get("conditions"),
                evidence_count=1,
                test_count=0,
                confirmation_count=0,
                last_observed=observation_date,
                status="hypothesis",
            )
            db.add(existing)
        patterns_by_name[name.lower()] = existing
    db.flush()  # give new patterns ids

    # --- Predictions ---
    # Only predictions that can be graded in code are kept: an untestable
    # prediction can never feed the scorecard, so it teaches nothing.
    for pred in memory_data.get("predictions") or []:
        condition = normalize_condition(pred.get("conditions"), pred.get("symbol"))
        target_days = valid_target_days(pred.get("target_days"))
        if not pred.get("text") or condition is None or target_days is None:
            logger.info(f"Dropped ungradable prediction: {str(pred.get('text'))[:80]!r}")
            continue
        # A prediction made on the strength of a pattern is a test of it
        pattern_name = (pred.get("pattern") or "").strip()
        pattern = None
        if pattern_name:
            pattern = patterns_by_name.get(pattern_name.lower()) or _find_pattern(db, pattern_name)
        db.add(AIPrediction(
            source_insight_id=insight_id,
            pattern_id=pattern.id if pattern else None,
            prediction_date=observation_date,
            target_date=observation_date + timedelta(days=target_days),
            category=pred.get("category", "price_direction"),
            symbol=condition["symbol"] or pred.get("symbol"),
            sector=pred.get("sector"),
            prediction_text=pred["text"],
            conditions=condition,
            reference_values=pred.get("reference_values"),
            status="pending",
        ))

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
    regime = db.query(AIMarketRegime).filter(
        AIMarketRegime.date >= today - timedelta(days=7)
    ).order_by(AIMarketRegime.date.desc()).first()
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

    # --- Active Patterns (every market insight, so names can be reused and tested) ---
    if insight_type in ("market_open", "hourly", "daily_close", "weekly_wrap"):
        rank = {"established": 0, "emerging": 1, "hypothesis": 2}
        patterns = db.query(AIPattern).filter(
            AIPattern.status.in_(list(rank)),
            # A pattern nobody has seen in a month is not an active one
            AIPattern.last_observed >= today - timedelta(days=30),
        ).all()
        patterns.sort(key=lambda p: (rank[p.status], -(p.test_count or 0), -(p.evidence_count or 0)))
        if patterns:
            pat_lines = []
            for p in patterns[:5]:
                tests = p.test_count or 0
                record = (
                    f"called {p.confirmation_count or 0} of {tests} tests right"
                    if tests else "untested"
                )
                pat_lines.append(
                    f'- "{p.pattern_name}" ({p.status}; seen {p.evidence_count or 1}x; {record})'
                )
            parts.append(
                "[ACTIVE PATTERNS]\n" + "\n".join(pat_lines)
                + "\nA pattern is only tested when you attach its exact name to a prediction."
            )

    # --- Graded outcomes of past predictions (the feedback signal) ---
    if insight_type in ("market_open", "daily_close", "weekly_wrap"):
        graded = db.query(AIPrediction).filter(
            AIPrediction.status.in_(["confirmed", "invalidated"]),
            AIPrediction.resolved_at >= datetime.now(timezone.utc) - timedelta(days=7),
        ).order_by(AIPrediction.resolved_at.desc()).limit(8).all()
        if graded:
            lines = [
                f'- {"RIGHT" if p.status == "confirmed" else "WRONG"}: "{p.prediction_text}" '
                f"({p.resolution_text})"
                for p in graded
            ]
            parts.append("[GRADED PREDICTIONS, LAST 7 DAYS]\n" + "\n".join(lines))

    if insight_type in ("daily_close", "weekly_wrap"):
        track_record = format_scorecard(get_prediction_scorecard(db, days=30))
        if track_record:
            parts.append(track_record)

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

def _end_of_day(d: date) -> datetime:
    """Midnight NPT at the end of business date d."""
    return datetime(d.year, d.month, d.day, tzinfo=NPT) + timedelta(days=1)


def _level_before(db: Session, symbol: str | None, before: datetime) -> tuple[float, datetime] | None:
    """Last known level strictly before a moment: a stock's price, or the NEPSE index if symbol is None."""
    if symbol is None:
        row = db.query(MarketSummary).filter(
            MarketSummary.time < before, MarketSummary.nepse_index > 0,
        ).order_by(MarketSummary.time.desc()).first()
        return (row.nepse_index, row.time) if row else None
    row = db.query(StockPrice).filter(
        StockPrice.symbol == symbol, StockPrice.time < before,
    ).order_by(StockPrice.time.desc()).first()
    return (row.ltp, row.time) if row else None


def _closing_level(
    db: Session, symbol: str | None, target: date, made_at: datetime
) -> tuple[float, datetime] | None:
    """Closing level for a target date, rolling forward to the next traded day.

    A target that lands on a weekend, a holiday, or a day the stock did not
    trade is graded on the first day after it that has data. Returns None
    until such a day exists.
    """
    day_end = _end_of_day(target)
    level = _level_before(db, symbol, day_end)
    if level and level[1] >= day_end - timedelta(days=1) and level[1] > made_at:
        return level

    if symbol is None:
        nxt = db.query(MarketSummary.time).filter(
            MarketSummary.time >= day_end, MarketSummary.nepse_index > 0,
        ).order_by(MarketSummary.time.asc()).first()
    else:
        nxt = db.query(StockPrice.time).filter(
            StockPrice.symbol == symbol, StockPrice.time >= day_end,
        ).order_by(StockPrice.time.asc()).first()
    if nxt is None:
        return None
    return _level_before(db, symbol, _end_of_day(nxt[0].astimezone(NPT).date()))


def _made_at(pred: AIPrediction) -> datetime:
    """When the prediction was made, as an aware datetime."""
    made = pred.created_at
    if made is None:
        return _end_of_day(pred.prediction_date)
    return made if made.tzinfo else made.replace(tzinfo=timezone.utc)


def grade_prediction(db: Session, pred: AIPrediction) -> dict | None:
    """Grade one prediction against the level on its target date.

    Returns None if it cannot be graded yet (no gradable condition, or no
    market data on or after the target date).
    """
    condition = normalize_condition(pred.conditions, pred.symbol)
    if condition is None or pred.target_date is None:
        return None

    made_at = _made_at(pred)
    end = _closing_level(db, condition["symbol"], pred.target_date, made_at)
    if end is None:
        return None
    end_value, end_time = end

    # The starting level only counts if it is recent; across a data gap the
    # baseline is unknown rather than measured from a stale price.
    start = _level_before(db, condition["symbol"], made_at)
    if start and start[1] < made_at - timedelta(days=5):
        start = None
    result = grade(condition, start[0] if start else None, end_value)
    if result is None:
        return None
    result["condition"] = condition
    result["value_time"] = end_time.isoformat()
    result["explanation"] = describe(condition, result)
    return result


def get_prediction_scorecard(db: Session, days: int = 30) -> dict:
    """Hit rate, naive-baseline hit rate and edge over the last N days."""
    cutoff = date.today() - timedelta(days=days)
    resolved = db.query(AIPrediction).filter(
        AIPrediction.resolved_at != None,
        AIPrediction.prediction_date >= cutoff,
    ).all()
    return summarize([
        {
            "status": p.status,
            "category": p.category,
            "baseline_correct": (p.outcome_values or {}).get("baseline_correct"),
        }
        for p in resolved
    ])


def format_scorecard(card: dict) -> str:
    """Scorecard as a prompt block. Empty string when nothing has been graded."""
    if not card["total"]:
        return ""
    lines = [
        f"[PREDICTION TRACK RECORD, LAST 30 DAYS]",
        f"{card['confirmed']} right / {card['invalidated']} wrong = {card['hit_rate_pct']:.0f}% hit rate.",
    ]
    if card["edge_pct"] is not None:
        lines.append(
            f"A forecaster assuming nothing changes scored {card['baseline_hit_rate_pct']:.0f}% on the same calls; "
            f"your edge is {card['edge_pct']:+.0f} points."
        )
    for cat, c in card["by_category"].items():
        edge = f", edge {c['edge_pct']:+.0f}" if c["edge_pct"] is not None else ""
        lines.append(f"- {cat}: {c['confirmed']}/{c['total']} right{edge}")
    return "\n".join(lines)


async def resolve_pending_predictions(db: Session, provider_manager=None) -> list[dict]:
    """Grade every pending prediction whose target date has arrived.

    Grading is done in code against the target-date level, never by a model.
    Predictions more than PREDICTION_GRACE_DAYS past their target, or with no
    gradable condition, are expired without a verdict.
    """
    today = date.today()
    now = datetime.now(timezone.utc)
    stale_before = today - timedelta(days=PREDICTION_GRACE_DAYS)

    due = db.query(AIPrediction).filter(
        AIPrediction.status == "pending",
        AIPrediction.target_date != None,
        AIPrediction.target_date <= today,
    ).order_by(AIPrediction.prediction_date.asc()).all()

    results = []
    touched_patterns: set[int] = set()
    for pred in due:
        if pred.target_date < stale_before:
            pred.status = "expired"
            pred.resolved_at = now
            pred.resolution_text = "Expired: not graded within a week of its target date."
            continue
        if normalize_condition(pred.conditions, pred.symbol) is None:
            pred.status = "expired"
            pred.resolved_at = now
            pred.resolution_text = "Expired: no condition that can be checked in code."
            continue

        result = grade_prediction(db, pred)
        if result is None:
            continue  # no target-date data yet; try again at the next close

        pred.status = result["status"]
        pred.resolved_at = now
        pred.resolution_text = result["explanation"]
        pred.outcome_values = {
            k: result[k] for k in ("observed", "start_value", "end_value", "value_time", "baseline_correct")
        }
        results.append({
            "prediction": pred.prediction_text,
            "status": result["status"],
            "explanation": result["explanation"],
        })
        if pred.pattern_id:
            touched_patterns.add(pred.pattern_id)

    for pattern in db.query(AIPattern).filter(AIPattern.id.in_(touched_patterns)).all() if touched_patterns else []:
        update_pattern_from_tests(db, pattern)

    try:
        db.commit()
        logger.info(f"Graded {len(results)} of {len(due)} due predictions")
    except Exception as e:
        logger.error(f"Failed to save prediction grades: {e}")
        db.rollback()
        return []

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
    # Summarize the most recent Monday-Sunday week whose Friday session is over.
    # Run on Saturday, that is the trading week that just ended.
    last_friday = today - timedelta(days=(today.weekday() - 4) % 7)
    period_start = last_friday - timedelta(days=4)
    period_end = period_start + timedelta(days=6)

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

    # Expire predictions too far past their target date to grade honestly
    overdue_cutoff = today - timedelta(days=PREDICTION_GRACE_DAYS)
    expired_preds = db.query(AIPrediction).filter(
        AIPrediction.status == "pending",
        AIPrediction.target_date != None,
        AIPrediction.target_date < overdue_cutoff,
    ).all()
    for p in expired_preds:
        p.status = "expired"
        p.resolved_at = datetime.now(timezone.utc)
        p.resolution_text = "Expired: not graded within a week of its target date."
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

_NULLABLE_STRING = {"type": ["string", "null"]}

# Memory is returned through a tool call rather than JSON written into the
# reply: the API hands back tool input as a parsed object, so a malformed or
# cut-off JSON block can no longer drop a whole memory update.
MEMORY_TOOL = {
    "name": "record_memory",
    "description": (
        "Record structured memory from the analysis you just wrote: observations, "
        "testable predictions, the market regime and recurring patterns. Call it "
        "exactly once, after the written analysis."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "observations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string", "enum": ["market_regime", "sector", "stock", "breadth", "anomaly"]},
                        "subcategory": _NULLABLE_STRING,
                        "symbol": _NULLABLE_STRING,
                        "sector": _NULLABLE_STRING,
                        "text": {"type": "string", "description": "One-sentence factual observation with specific numbers"},
                        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
                        "data_snapshot": {"type": "object", "description": "Up to 3 key metrics"},
                    },
                    "required": ["category", "text", "confidence"],
                },
            },
            "predictions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "category": {"type": "string", "enum": ["price_direction", "sector_rotation", "breakout", "support_test"]},
                        "symbol": _NULLABLE_STRING,
                        "sector": _NULLABLE_STRING,
                        "text": {"type": "string", "description": "Specific forward-looking statement"},
                        "conditions": {
                            "type": "object",
                            "description": "What will be TRUE on the target date if the prediction is right",
                            "properties": {
                                "metric": {"type": "string", "enum": ["price", "nepse_index", "change_pct"]},
                                "symbol": {"type": ["string", "null"], "description": "Stock symbol, or null for the NEPSE index"},
                                "direction": {"type": "string", "enum": ["above", "below"]},
                                "threshold": {"type": "number"},
                            },
                            "required": ["metric", "symbol", "direction", "threshold"],
                        },
                        "reference_values": {"type": "object", "description": "Up to 3 values at prediction time"},
                        "target_days": {"type": "integer", "description": "Calendar days from today, 1 to 30"},
                        "pattern": {
                            "type": ["string", "null"],
                            "description": "Exact name of the pattern this prediction is based on, if any. The graded result then counts as a test of that pattern.",
                        },
                    },
                    "required": ["category", "text", "conditions", "target_days"],
                },
            },
            "regime": {
                "type": ["object", "null"],
                "properties": {
                    "trend": {"type": "string", "enum": ["bullish", "bearish", "sideways", "transitioning"]},
                    "trend_strength": {"type": "string", "enum": ["weak", "moderate", "strong"]},
                    "volatility": {"type": "string", "enum": ["low", "normal", "elevated", "extreme"]},
                    "breadth_health": {"type": "string", "enum": ["healthy", "narrowing", "weak", "divergent"]},
                    "leading_sectors": {"type": "array", "items": {"type": "string"}},
                    "lagging_sectors": {"type": "array", "items": {"type": "string"}},
                    "key_levels": {"type": "object", "description": "e.g. {\"support\": 2380, \"resistance\": 2500}"},
                },
            },
            "patterns": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Short descriptive name"},
                        "description": {"type": "string"},
                        "category": {"type": "string", "enum": ["sector_rotation", "momentum", "seasonal", "volume", "correlation"]},
                        "action": {"type": "string", "enum": ["new", "reinforce"]},
                    },
                    "required": ["name", "action"],
                },
            },
        },
        "required": ["observations", "predictions"],
    },
}

MEMORY_EXTRACTION_INSTRUCTION = """

After your written analysis, call the record_memory tool exactly once to store what you learned. This is how your market understanding builds over time. Write the analysis as plain text first; do not put JSON or tool arguments in the text.

Guidelines for memory extraction:
- observations: 2-5 per analysis. Be specific with numbers. Focus on what changed or stands out.
- predictions: 0-3 per analysis. Each one is graded automatically by code on its target date and the result is shown back to you, so every prediction MUST carry a testable condition:
  - "conditions" states what will be TRUE on the target date if you are right. It must say the same thing as "text".
  - metric "price": closing price of the symbol. metric "nepse_index": the index level. metric "change_pct": percent change from today's level to the target-date close (symbol null = NEPSE index).
  - "target_days": calendar days from today, 1 to 30. Required.
  - Predictions without a valid condition and target_days are discarded.
  - You are also scored against a forecaster who assumes nothing changes. A condition that is already true today earns no credit, so call moves, not the status quo. If you have no real view, make no prediction.
  - Use your graded predictions and track record in memory to decide what kinds of calls to keep making.
- regime: Always include. Assess the overall market state honestly.
- patterns: Only when you notice a recurring behavior. Use "reinforce" only with the exact "name" of a pattern listed under ACTIVE PATTERNS in your memory; a reinforce of any other name is ignored. Use "new" for a genuinely new pattern, not a rewording of an active one.
  - Seeing a pattern again does not prove it. A pattern is promoted from hypothesis to emerging to established only by predictions that test it, and it is thrown out if those keep failing.
  - To test a pattern, make a prediction of what it implies will happen next and set that prediction's "pattern" to the pattern's exact name. Prefer testing an active pattern from memory over inventing a new one.
- Do NOT fabricate observations — only record what the data shows.
- Keep data_snapshot and reference_values to at most 3 keys each."""
