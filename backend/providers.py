"""Data provider abstraction for primary/fallback NEPSE data sources."""

import logging
import httpx
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class DataProvider(ABC):
    """Abstract base for NEPSE data sources."""

    @abstractmethod
    async def get_market_status(self) -> Dict[str, Any]:
        """Return {'isOpen': 'OPEN'|'CLOSE', 'asOf': ISO8601}."""
        pass

    @abstractmethod
    async def get_live_market(self) -> List[Dict[str, Any]]:
        """Return list of all live market prices."""
        pass

    @abstractmethod
    async def get_floorsheet(self, symbol: str) -> List[Dict[str, Any]]:
        """Return floorsheet (all trades) for symbol."""
        pass


class NepseAPIProvider(DataProvider):
    """Primary: NepseAPI-Unofficial (self-hosted Docker on :8000)."""

    def __init__(self, base_url: str, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.client = httpx.AsyncClient(timeout=timeout)

    async def get_market_status(self) -> Dict[str, Any]:
        """Fetch market status from REST."""
        try:
            response = await self.client.get(f"{self.base_url}/IsNepseOpen")
            response.raise_for_status()
            data = response.json()
            return {
                "isOpen": data.get("isOpen", "UNKNOWN"),
                "asOf": data.get("asOf"),
            }
        except httpx.HTTPError as e:
            logger.error(f"NepseAPI market_status failed: {e}")
            raise

    async def get_live_market(self) -> List[Dict[str, Any]]:
        """Fetch all live market prices."""
        try:
            response = await self.client.get(f"{self.base_url}/LiveMarket")
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else []
        except httpx.HTTPError as e:
            logger.error(f"NepseAPI live_market failed: {e}")
            raise

    async def get_floorsheet(self, symbol: str) -> List[Dict[str, Any]]:
        """Fetch floorsheet for symbol."""
        try:
            response = await self.client.get(f"{self.base_url}/FloorsheetOf", params={"symbol": symbol})
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else []
        except httpx.HTTPError as e:
            logger.error(f"NepseAPI floorsheet({symbol}) failed: {e}")
            raise

    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()


class DataProviderManager:
    """Manages primary + fallback provider with automatic failover."""

    def __init__(self, primary: DataProvider, fallback: Optional[DataProvider] = None):
        self.primary = primary
        self.fallback = fallback
        self.current = primary
        self.failed_over = False

    async def get_market_status(self) -> Dict[str, Any]:
        """Get market status, failover if needed."""
        try:
            return await self.primary.get_market_status()
        except (httpx.HTTPError, Exception) as e:
            logger.warning(f"Primary failed, trying fallback: {e}")
            if self.fallback:
                self.failed_over = True
                return await self.fallback.get_market_status()
            raise

    async def get_live_market(self) -> List[Dict[str, Any]]:
        """Get live market, failover if needed."""
        try:
            return await self.primary.get_live_market()
        except (httpx.HTTPError, Exception) as e:
            logger.warning(f"Primary failed, trying fallback: {e}")
            if self.fallback:
                self.failed_over = True
                return await self.fallback.get_live_market()
            raise

    async def get_floorsheet(self, symbol: str) -> List[Dict[str, Any]]:
        """Get floorsheet, failover if needed."""
        try:
            return await self.primary.get_floorsheet(symbol)
        except (httpx.HTTPError, Exception) as e:
            logger.warning(f"Primary failed for {symbol}, trying fallback: {e}")
            if self.fallback:
                self.failed_over = True
                return await self.fallback.get_floorsheet(symbol)
            raise
