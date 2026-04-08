"""Simple in-memory TTL cache for NepseAPI snapshot data.

Uses cachetools.TTLCache with a threading.Lock for thread-safe access.
All cached values include a `meta` dict with source and asOf timestamp.
"""

import threading
import zoneinfo
from datetime import datetime, timezone

NPT = zoneinfo.ZoneInfo("Asia/Kathmandu")
from typing import Any

try:
    from cachetools import TTLCache
except ImportError:
    TTLCache = None  # type: ignore


class _FallbackTTLCache:
    """Minimal TTL cache if cachetools is not installed."""

    def __init__(self, maxsize: int, ttl: float) -> None:
        self._store: dict[str, tuple[float, Any]] = {}
        self._ttl = ttl

    def get(self, key: str) -> Any | None:
        import time
        entry = self._store.get(key)
        if entry is None:
            return None
        expiry, value = entry
        if time.monotonic() > expiry:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        import time
        self._store[key] = (time.monotonic() + self._ttl, value)

    def clear(self) -> None:
        self._store.clear()


class SnapshotCache:
    """Thread-safe, named-TTL cache for NepseAPI snapshot data.

    Each key can have its own TTL in seconds. If cachetools is available,
    we use TTLCache buckets per TTL; otherwise we fall back to a simple dict.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # key -> (expiry_monotonic, value)
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        import time
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            expiry, value = entry
            if time.monotonic() > expiry:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: int) -> None:
        import time
        with self._lock:
            self._store[key] = (time.monotonic() + ttl, value)

    def clear(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._store.clear()
            else:
                self._store.pop(key, None)


def make_envelope(data: Any, source: str = "cache") -> dict:
    """Wrap data in the standard response envelope."""
    return {
        "data": data,
        "meta": {
            "source": source,
            "asOf": datetime.now(NPT).isoformat(),
            "stale": source == "db",
        },
    }


# Module-level singleton
_cache = SnapshotCache()


def get_cache() -> SnapshotCache:
    return _cache
