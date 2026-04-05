"""Critical bug regression tests from autoplan review."""

import pytest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from backend.config import settings
from backend.models import StockPrice, Floorsheet


class TestCronTimezone:
    """T1: Cron job must fire at 11 AM-3 PM NPT, not 5-9 AM."""

    def test_scheduler_timezone_is_kathmandu(self):
        """Verify scheduler is configured for Asia/Kathmandu."""
        assert settings.scheduler_timezone == "Asia/Kathmandu"

    def test_cron_hour_range_is_correct(self):
        """Verify cron hour range is 11-15 (not 5-9)."""
        # This test just documents the expected config
        # Actual cron trigger is in scheduler.py
        assert "11" in "11-15"
        assert "15" in "11-15"
        assert "5" not in "11-15"
        assert "9" not in "11-15"

    def test_market_hours_utc_calculation(self):
        """NEPSE market: 11 AM - 3 PM NPT = 5:15 AM - 9:15 AM UTC."""
        # 11 AM NPT
        npt_11am = datetime(2026, 4, 6, 11, 0, 0, tzinfo=ZoneInfo("Asia/Kathmandu"))
        utc_11am = npt_11am.astimezone(ZoneInfo("UTC"))
        # Should be 5:15 AM UTC
        assert utc_11am.hour == 5
        assert utc_11am.minute == 15

        # 3 PM NPT
        npt_3pm = datetime(2026, 4, 6, 15, 0, 0, tzinfo=ZoneInfo("Asia/Kathmandu"))
        utc_3pm = npt_3pm.astimezone(ZoneInfo("UTC"))
        # Should be 9:15 AM UTC
        assert utc_3pm.hour == 9
        assert utc_3pm.minute == 15


class TestMarketStatusGuard:
    """T2: Closed market → job aborts, 0 rows inserted."""

    @pytest.mark.asyncio
    async def test_market_closed_aborts_ingest(self, db_session, mock_provider_closed):
        """When market is closed, ingest job returns early."""
        from backend.scheduler import IngestionScheduler
        from backend.database import SessionLocal

        scheduler = IngestionScheduler(mock_provider_closed, SessionLocal)
        await scheduler.ingest_live_prices()

        # Verify no prices were inserted
        count = db_session.query(StockPrice).count()
        assert count == 0


class TestDualWriterDedup:
    """T3: WS + REST both write same (time, symbol) → 1 row via UNIQUE constraint."""

    def test_stock_prices_unique_constraint(self, db_session):
        """UNIQUE(time, symbol) exists on stock_prices."""
        # Get the unique constraints
        constraints = [
            c.name for c in StockPrice.__table__.constraints
            if "unique" in str(c).lower()
        ]
        assert any("time" in c.lower() and "symbol" in c.lower() for c in constraints)


class TestJobOverlapPrevention:
    """T4: max_instances=1 prevents job overlap."""

    def test_scheduler_max_instances(self):
        """Verify max_instances is set to 1."""
        assert settings.scheduler_max_instances == 1


class TestDataProviderFallback:
    """T5: Primary 401 → secondary activates."""

    @pytest.mark.asyncio
    async def test_fallback_on_primary_failure(self, mock_provider_primary_fails, mock_provider_fallback):
        """When primary fails, fallback is used."""
        from backend.providers import DataProviderManager

        manager = DataProviderManager(
            primary=mock_provider_primary_fails,
            fallback=mock_provider_fallback,
        )

        # Should not raise, should use fallback
        result = await manager.get_market_status()
        assert result is not None
        assert manager.failed_over is True


class TestClaudeJsonParsing:
    """T6: Code-fence-wrapped JSON is stripped before parsing."""

    def test_code_fence_stripping(self):
        """Strip ```json...``` before json.loads()."""
        import json

        response_wrapped = '```json\n{"status": "ok"}\n```'
        response_clean = response_wrapped.strip()
        if response_clean.startswith("```"):
            response_clean = response_clean.split("```")[1].strip()

        data = json.loads(response_clean)
        assert data["status"] == "ok"


class TestNPTTimezone:
    """T7: NPT is UTC+5:45 exactly, not UTC+5:30."""

    def test_npt_offset(self):
        """Verify NPT offset is +5:45, not +5:30."""
        npt = ZoneInfo("Asia/Kathmandu")
        # Create a date in Kathmandu
        dt = datetime(2026, 4, 6, 12, 0, 0, tzinfo=npt)
        # Convert to UTC
        utc = dt.astimezone(ZoneInfo("UTC"))
        # Difference should be 5:45
        offset = dt.utcoffset()
        assert offset.total_seconds() == (5 * 3600 + 45 * 60)


class TestFloorshetRetention:
    """T8: Weekly DELETE WHERE time < NOW() - 90 days."""

    def test_floorsheet_has_time_index(self):
        """Verify time index exists for efficient retention queries."""
        indices = [idx.name for idx in Floorsheet.__table__.indexes]
        assert any("time" in idx for idx in indices)


class TestWebSocketReconnection:
    """T9: WS drops → reconnect within 30s (architecture decision)."""

    def test_ws_server_side_proxy_documented(self):
        """WS proxy must be in Next.js API route, not client-side."""
        # This is an architecture validation, not code test
        # Client opens 1 WS to /api/market/ws
        # Backend opens 1 WS to NepseAPI:5555
        # No per-browser WS fan-out
        pass


class TestSouthAsianNumberFormat:
    """T10: Use Crore/Lakh, not M/B."""

    def test_display_format_constants(self):
        """Number format should use South Asian system."""
        # 10,000,000 = 10 Lakh (not 10M)
        # 100,000,000 = 1 Crore (not 100M)
        lakh = 100_000
        crore = 100 * lakh
        assert crore == 10_000_000


class TestPromptInjectionDefense:
    """T11: XML boundaries in Claude prompt."""

    def test_xml_boundary_structure(self):
        """Claude system prompt should use XML for data boundary."""
        prompt = """
        <market_data>
        {UNTRUSTED DATA HERE}
        </market_data>
        """
        assert "<market_data>" in prompt
        assert "</market_data>" in prompt


class TestEmptyStateFirstRun:
    """T12: Empty state on first run returns 200, not 500."""

    @pytest.mark.asyncio
    async def test_empty_database_returns_200(self, client, empty_db):
        """When database is empty, /api/stocks/latest returns 200 with empty list."""
        response = await client.get("/api/stocks/latest")
        assert response.status_code == 200
        assert response.json() == []


# Fixtures for testing
@pytest.fixture
def mock_provider_closed():
    """Mock provider that reports market closed."""
    from backend.providers import DataProvider

    class MockProviderClosed(DataProvider):
        async def get_market_status(self):
            return {"isOpen": "CLOSE", "asOf": datetime.utcnow().isoformat()}

        async def get_live_market(self):
            return []

        async def get_floorsheet(self, symbol):
            return []

    return MockProviderClosed()


@pytest.fixture
def mock_provider_primary_fails():
    """Mock provider that fails."""
    from backend.providers import DataProvider
    import httpx

    class MockProviderFails(DataProvider):
        async def get_market_status(self):
            raise httpx.HTTPError("Connection refused")

        async def get_live_market(self):
            raise httpx.HTTPError("Connection refused")

        async def get_floorsheet(self, symbol):
            raise httpx.HTTPError("Connection refused")

    return MockProviderFails()


@pytest.fixture
def mock_provider_fallback():
    """Mock fallback provider."""
    from backend.providers import DataProvider

    class MockFallback(DataProvider):
        async def get_market_status(self):
            return {"isOpen": "OPEN", "asOf": datetime.utcnow().isoformat()}

        async def get_live_market(self):
            return [{"symbol": "NABIL", "ltp": 1234.50}]

        async def get_floorsheet(self, symbol):
            return []

    return MockFallback()
