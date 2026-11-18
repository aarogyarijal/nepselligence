"""Nepal Time (NPT) helpers.

NEPSE runs on Nepal time, so "today" and every date derived from a timestamp
mean the Nepal calendar date. Do not use date.today() or datetime.now()
without a timezone: they follow the server's clock setting (UTC in the
containers), which is the previous Nepal date between 00:00 and 05:45 NPT.
"""

import zoneinfo
from datetime import date, datetime, timezone

NPT = zoneinfo.ZoneInfo("Asia/Kathmandu")

# NPT is a fixed UTC+5:45 with no daylight saving.
NPT_OFFSET_SECONDS = 5 * 3600 + 45 * 60


def utc_now() -> datetime:
    """Current instant as a timezone-aware datetime."""
    return datetime.now(timezone.utc)


def npt_now() -> datetime:
    """Current instant in Nepal time."""
    return datetime.now(NPT)


def npt_today() -> date:
    """Today's calendar date in Nepal."""
    return npt_now().date()


def npt_date(dt: datetime) -> date:
    """Nepal calendar date of a timezone-aware datetime."""
    return dt.astimezone(NPT).date()


def npt_day_start(d: date | None = None) -> datetime:
    """Midnight NPT at the start of date d (today when omitted)."""
    d = d or npt_today()
    return datetime(d.year, d.month, d.day, tzinfo=NPT)


def to_npt_iso(dt: datetime) -> str:
    """ISO string with the +05:45 offset."""
    return dt.astimezone(NPT).isoformat()


def parse_npt_time(value: str | None) -> datetime | None:
    """Parse a timestamp from NEPSE. One with no offset is Nepal wall-clock time.

    Passing such a string straight to a timestamptz column makes the database
    read it as UTC, which stores the trade 5 hours 45 minutes late.
    """
    if not value:
        return None
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=NPT)


def npt_bucket_start(epoch: int, interval_minutes: int) -> int:
    """Epoch of the start of the NPT clock bucket containing `epoch`.

    Buckets line up with the Nepal clock (hourly candles start at 11:00, not
    10:45; daily ones at NPT midnight) rather than with UTC.
    """
    step = interval_minutes * 60
    return ((epoch + NPT_OFFSET_SECONDS) // step) * step - NPT_OFFSET_SECONDS


def bucket_label(bucket_epoch: int, interval_minutes: int) -> str:
    """API time for a bucket: a plain NPT date for daily buckets, else an NPT timestamp."""
    dt = datetime.fromtimestamp(bucket_epoch, tz=NPT)
    if interval_minutes >= 1440:
        return dt.date().isoformat()
    return dt.isoformat()
