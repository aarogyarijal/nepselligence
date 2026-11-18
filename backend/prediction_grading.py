"""Deterministic grading of AI predictions.

A prediction is graded in code against the value on its target date, never by
asking a model whether it "came true". Every graded prediction is also scored
against a naive baseline, so a hit rate can be compared with guessing.

Stdlib only, so the rules can be tested without the app or a database.
"""

from __future__ import annotations

import math

GRADABLE_METRICS = ("price", "nepse_index", "change_pct")
MAX_TARGET_DAYS = 30
# How long after its target date a prediction can still be graded. Covers
# weekends and holidays; anything older is expired instead of graded late.
PREDICTION_GRACE_DAYS = 7

_INDEX_ALIASES = {"NEPSE", "NEPSE INDEX", "INDEX"}


def normalize_condition(conditions, symbol: str | None = None) -> dict | None:
    """Return a gradable condition, or None if it cannot be checked in code.

    A gradable condition reads: "on the target date, <metric> of <symbol> is
    <direction> <threshold>". symbol None means the NEPSE index.
    change_pct is the percent change from the prediction date to the target date.
    """
    if not isinstance(conditions, dict):
        return None

    metric = str(conditions.get("metric") or "").strip().lower()
    if metric == "ltp":
        metric = "price"
    if metric not in GRADABLE_METRICS:
        return None

    direction = str(conditions.get("direction") or "").strip().lower()
    if direction not in ("above", "below"):
        return None

    raw_threshold = conditions.get("threshold")
    if isinstance(raw_threshold, bool):
        return None
    try:
        threshold = float(raw_threshold)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(threshold):
        return None

    sym = conditions.get("symbol") or symbol
    sym = str(sym).strip().upper() if sym else None
    if sym in _INDEX_ALIASES or metric == "nepse_index":
        sym = None
    if metric == "price" and sym is None:
        metric = "nepse_index"

    return {"metric": metric, "symbol": sym, "direction": direction, "threshold": threshold}


def duplicate_key(condition: dict, target_date) -> tuple:
    """Identity of a call for spotting repeats among pending predictions.

    Two predictions are the same call when they name the same symbol (None is
    the NEPSE index), the same direction and the same target date. Metric and
    threshold are left out on purpose: "RSML above 2700" and "RSML above 2702"
    for the same day are one call made twice.
    """
    return (condition["symbol"], condition["direction"], target_date)


def valid_target_days(target_days) -> int | None:
    """Return target_days as an int in 1..MAX_TARGET_DAYS, else None."""
    if isinstance(target_days, bool):
        return None
    try:
        days = int(target_days)
    except (TypeError, ValueError):
        return None
    if days != target_days and not isinstance(target_days, str):
        return None
    return days if 1 <= days <= MAX_TARGET_DAYS else None


def _holds(direction: str, threshold: float, value: float) -> bool:
    return value > threshold if direction == "above" else value < threshold


def grade(condition: dict, start_value: float | None, end_value: float | None) -> dict | None:
    """Grade a normalized condition.

    start_value: level of the series when the prediction was made.
    end_value: level of the series on the target date.

    Returns None when there is not enough data to grade. Otherwise a dict with
    status ("confirmed" / "invalidated"), the observed value, and
    baseline_correct: whether a forecaster who assumed nothing would change
    between the two dates got the same claim right (None if unknown).
    """
    if end_value is None:
        return None

    direction, threshold = condition["direction"], condition["threshold"]

    if condition["metric"] == "change_pct":
        if not start_value:
            return None
        observed = (end_value / start_value - 1) * 100
        unchanged = 0.0
    else:
        observed = end_value
        unchanged = start_value

    came_true = _holds(direction, threshold, observed)
    baseline_correct = None
    if unchanged is not None:
        baseline_correct = _holds(direction, threshold, unchanged) == came_true

    return {
        "status": "confirmed" if came_true else "invalidated",
        "observed": round(observed, 2),
        "start_value": start_value,
        "end_value": end_value,
        "baseline_correct": baseline_correct,
    }


def describe(condition: dict, result: dict) -> str:
    """One-line, human-readable verdict for a graded prediction."""
    target = condition["symbol"] or "NEPSE"
    if condition["metric"] == "change_pct":
        what = f"{target} change of {result['observed']:+.2f}%"
        limit = f"{condition['threshold']:g}%"
    else:
        what = f"{target} at {result['observed']:g}"
        limit = f"{condition['threshold']:g}"
    verdict = "met" if result["status"] == "confirmed" else "missed"
    return f"{what} {verdict} the call for {condition['direction']} {limit}."


def summarize(records: list[dict]) -> dict:
    """Build a scorecard from resolved predictions.

    Each record needs "status" and may carry "baseline_correct" and "category".
    Hit rate is over graded predictions only; expired ones are counted
    separately and do not move the rate.
    """
    def score(rows: list[dict]) -> dict:
        confirmed = sum(1 for r in rows if r["status"] == "confirmed")
        partial = sum(1 for r in rows if r["status"] == "partially_confirmed")
        invalidated = sum(1 for r in rows if r["status"] == "invalidated")
        graded = confirmed + partial + invalidated
        hit_rate = (confirmed + partial * 0.5) / graded * 100 if graded else 0.0

        with_baseline = [
            r for r in rows
            if r["status"] in ("confirmed", "invalidated") and r.get("baseline_correct") is not None
        ]
        baseline_rate = edge = None
        if with_baseline:
            baseline_rate = sum(1 for r in with_baseline if r["baseline_correct"]) / len(with_baseline) * 100
            own_rate = sum(1 for r in with_baseline if r["status"] == "confirmed") / len(with_baseline) * 100
            edge = own_rate - baseline_rate

        return {
            "total": graded,
            "confirmed": confirmed,
            "partially_confirmed": partial,
            "invalidated": invalidated,
            "hit_rate_pct": hit_rate,
            "baseline_hit_rate_pct": baseline_rate,
            "edge_pct": edge,
        }

    card = score(records)
    card["expired"] = sum(1 for r in records if r["status"] == "expired")

    by_category: dict[str, dict] = {}
    for cat in sorted({r.get("category") or "uncategorized" for r in records}):
        rows = [r for r in records if (r.get("category") or "uncategorized") == cat]
        cat_card = score(rows)
        if cat_card["total"]:
            by_category[cat] = cat_card
    card["by_category"] = by_category
    return card


# ---------------------------------------------------------------------------
# Patterns: a pattern earns its status from the predictions made on it
# ---------------------------------------------------------------------------

PATTERN_MIN_TESTS = 3          # tests before a pattern can leave "hypothesis"
PATTERN_ESTABLISHED_TESTS = 8  # tests before it can be called "established"
PATTERN_PROMOTE_RATE = 0.6     # share of tests it must get right to be promoted
PATTERN_RETIRE_TESTS = 5       # tests before it can be thrown out
PATTERN_RETIRE_RATE = 0.4      # at or below this share right, it is invalidated


def pattern_test_outcome(status: str, baseline_correct: bool | None) -> bool | None:
    """What a graded prediction says about the pattern it was based on.

    True = the pattern called it, False = the pattern got it wrong,
    None = no information. A prediction that came true but that the
    no-change baseline also got right would have come true with or without
    the pattern, so it is not counted as a confirmation.
    """
    if status == "confirmed":
        return None if baseline_correct is True else True
    if status == "invalidated":
        return False
    return None


def pattern_status(confirmations: int, tests: int) -> str:
    """Status a pattern has earned from its track record."""
    if tests < PATTERN_MIN_TESTS:
        return "hypothesis"
    rate = confirmations / tests
    if tests >= PATTERN_RETIRE_TESTS and rate <= PATTERN_RETIRE_RATE:
        return "invalidated"
    if rate >= PATTERN_PROMOTE_RATE:
        return "established" if tests >= PATTERN_ESTABLISHED_TESTS else "emerging"
    return "hypothesis"
