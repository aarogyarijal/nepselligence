"""Pure-Python technical indicator functions.

All functions take plain lists of floats and return a value (or None when
there are insufficient data points). No numpy, pandas, or ta-lib required.
"""

from __future__ import annotations


def sma(closes: list[float], period: int) -> float | None:
    if len(closes) < period:
        return None
    return round(sum(closes[-period:]) / period, 2)


def _ema_series(values: list[float], period: int) -> list[float]:
    """Full EMA series (same length as input, prefixed with NaN-equivalent 0s)."""
    if len(values) < period:
        return []
    multiplier = 2 / (period + 1)
    result: list[float] = []
    seed = sum(values[:period]) / period
    result.append(seed)
    for v in values[period:]:
        result.append((v - result[-1]) * multiplier + result[-1])
    return result


def ema(closes: list[float], period: int) -> float | None:
    series = _ema_series(closes, period)
    return round(series[-1], 2) if series else None


def sma_series(closes: list[float], dates: list[str], period: int) -> list[dict]:
    """Return [{date, value}] for each point where the SMA is defined."""
    if len(closes) < period:
        return []
    out = []
    for i in range(period - 1, len(closes)):
        val = sum(closes[i - period + 1: i + 1]) / period
        out.append({"date": dates[i], "value": round(val, 2)})
    return out


def rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) < period + 1:
        return None
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    # Wilder's smoothing
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def macd(closes: list[float]) -> dict | None:
    if len(closes) < 35:  # need 26 seed + 9 signal
        return None
    ema12 = _ema_series(closes, 12)
    ema26 = _ema_series(closes, 26)
    # Align: ema26 is shorter — it starts 14 bars later in ema12
    offset = len(ema12) - len(ema26)
    macd_line = [ema12[offset + i] - ema26[i] for i in range(len(ema26))]
    signal_series = _ema_series(macd_line, 9)
    if not signal_series:
        return None
    macd_val = macd_line[-1]
    sig_val = signal_series[-1]
    return {
        "macd": round(macd_val, 2),
        "signal": round(sig_val, 2),
        "histogram": round(macd_val - sig_val, 2),
    }


def bollinger(closes: list[float], period: int = 20, num_std: float = 2.0) -> dict | None:
    if len(closes) < period:
        return None
    window = closes[-period:]
    middle = sum(window) / period
    variance = sum((x - middle) ** 2 for x in window) / period
    std = variance ** 0.5
    return {
        "upper": round(middle + num_std * std, 2),
        "middle": round(middle, 2),
        "lower": round(middle - num_std * std, 2),
    }


def bollinger_series(
    closes: list[float],
    dates: list[str],
    period: int = 20,
    num_std: float = 2.0,
) -> list[dict]:
    """Return [{date, upper, lower}] for each point where Bollinger is defined."""
    if len(closes) < period:
        return []
    out = []
    for i in range(period - 1, len(closes)):
        window = closes[i - period + 1: i + 1]
        mid = sum(window) / period
        std = (sum((x - mid) ** 2 for x in window) / period) ** 0.5
        out.append({
            "date": dates[i],
            "upper": round(mid + num_std * std, 2),
            "lower": round(mid - num_std * std, 2),
        })
    return out


def atr(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    period: int = 14,
) -> float | None:
    if len(closes) < period + 1:
        return None
    true_ranges: list[float] = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        true_ranges.append(tr)
    # Wilder's smoothing
    atr_val = sum(true_ranges[:period]) / period
    for i in range(period, len(true_ranges)):
        atr_val = (atr_val * (period - 1) + true_ranges[i]) / period
    return round(atr_val, 2)


def period_return(closes: list[float], days: int) -> float | None:
    """% return comparing closes[-1] to closes[-(days+1)]."""
    if len(closes) <= days:
        return None
    old = closes[-(days + 1)]
    if old == 0:
        return None
    return round(((closes[-1] - old) / old) * 100, 2)


def historical_volatility(closes: list[float], period: int = 30) -> dict | None:
    if len(closes) < period + 1:
        return None
    subset = closes[-(period + 1):]
    returns = [
        (subset[i] / subset[i - 1]) - 1
        for i in range(1, len(subset))
        if subset[i - 1] != 0
    ]
    if len(returns) < 2:
        return None
    mean = sum(returns) / len(returns)
    variance = sum((r - mean) ** 2 for r in returns) / len(returns)
    daily = variance ** 0.5
    # NEPSE has ~220 trading days/year
    return {
        "daily30d": round(daily, 4),
        "annualized30d": round(daily * (220 ** 0.5), 4),
    }


def derive_signals(
    ltp: float,
    sma20: float | None,
    sma50: float | None,
    sma200: float | None,
    rsi14: float | None,
    volume_ratio: float | None,
) -> dict:
    # Trend
    if sma20 and sma50 and sma200:
        if ltp > sma20 > sma50 > sma200:
            trend = "bullish"
        elif ltp < sma20 < sma50 < sma200:
            trend = "bearish"
        else:
            trend = "neutral"
    elif sma50:
        trend = "bullish" if ltp > sma50 else "bearish"
    else:
        trend = None

    # Momentum (RSI)
    if rsi14 is not None:
        if rsi14 > 70:
            momentum = "overbought"
        elif rsi14 < 30:
            momentum = "oversold"
        else:
            momentum = "neutral"
    else:
        momentum = None

    # Volume trend
    if volume_ratio is not None:
        if volume_ratio > 1.5:
            volume_trend = "increasing"
        elif volume_ratio < 0.7:
            volume_trend = "decreasing"
        else:
            volume_trend = "stable"
    else:
        volume_trend = None

    # Price vs SMAs
    if sma50 and sma200:
        above_50 = ltp > sma50
        above_200 = ltp > sma200
        if above_50 and above_200:
            price_vs_sma = "above_all"
        elif above_50:
            price_vs_sma = "above_50"
        elif not above_50 and not above_200:
            price_vs_sma = "below_all"
        else:
            price_vs_sma = "mixed"
    elif sma50:
        price_vs_sma = "above_50" if ltp > sma50 else "below_50"
    else:
        price_vs_sma = None

    return {
        "trend": trend,
        "momentum": momentum,
        "volumeTrend": volume_trend,
        "priceVsSMA": price_vs_sma,
    }
