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
    async def get_nepse_index(self) -> Any:
        """Return NEPSE index data (list of indices or single dict)."""
        pass

    @abstractmethod
    async def get_market_summary(self) -> Dict[str, Any]:
        """Return market summary (turnover, shares, transactions)."""
        pass

    @abstractmethod
    async def get_floorsheet(self, symbol: str) -> List[Dict[str, Any]]:
        """Return floorsheet (all trades) for symbol."""
        pass

    @abstractmethod
    async def get_sub_indices(self) -> List[Dict[str, Any]]:
        """Return 13 sector sub-indices."""
        pass

    @abstractmethod
    async def get_top_gainers(self) -> List[Dict[str, Any]]:
        """Return top gaining stocks."""
        pass

    @abstractmethod
    async def get_top_losers(self) -> List[Dict[str, Any]]:
        """Return top losing stocks."""
        pass

    @abstractmethod
    async def get_top_turnover(self) -> List[Dict[str, Any]]:
        """Return top 10 stocks by turnover."""
        pass

    @abstractmethod
    async def get_company_list(self) -> List[Dict[str, Any]]:
        """Return list of all active companies."""
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

    async def get_nepse_index(self) -> Any:
        """Fetch NEPSE index data."""
        try:
            response = await self.client.get(f"{self.base_url}/NepseIndex")
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            logger.error(f"NepseAPI nepse_index failed: {e}")
            raise

    async def get_market_summary(self) -> Dict[str, Any]:
        """Fetch market summary."""
        try:
            response = await self.client.get(f"{self.base_url}/Summary")
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, dict) else {}
        except httpx.HTTPError as e:
            logger.error(f"NepseAPI market_summary failed: {e}")
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

    async def get_sub_indices(self) -> List[Dict[str, Any]]:
        """Fetch sector sub-indices."""
        try:
            response = await self.client.get(f"{self.base_url}/NepseSubIndices")
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else []
        except httpx.HTTPError as e:
            logger.error(f"NepseAPI sub_indices failed: {e}")
            raise

    async def get_top_gainers(self) -> List[Dict[str, Any]]:
        """Fetch top gainers."""
        try:
            response = await self.client.get(f"{self.base_url}/TopGainers")
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else []
        except httpx.HTTPError as e:
            logger.error(f"NepseAPI top_gainers failed: {e}")
            raise

    async def get_top_losers(self) -> List[Dict[str, Any]]:
        """Fetch top losers."""
        try:
            response = await self.client.get(f"{self.base_url}/TopLosers")
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else []
        except httpx.HTTPError as e:
            logger.error(f"NepseAPI top_losers failed: {e}")
            raise

    async def get_top_turnover(self) -> List[Dict[str, Any]]:
        """Fetch top 10 stocks by turnover."""
        try:
            response = await self.client.get(f"{self.base_url}/TopTenTurnoverScrips")
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else []
        except httpx.HTTPError as e:
            logger.error(f"NepseAPI top_turnover failed: {e}")
            raise

    async def get_company_list(self) -> List[Dict[str, Any]]:
        """Fetch list of all companies."""
        try:
            response = await self.client.get(f"{self.base_url}/CompanyList")
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else []
        except httpx.HTTPError as e:
            logger.error(f"NepseAPI company_list failed: {e}")
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

    async def get_nepse_index(self) -> Any:
        """Get NEPSE index, failover if needed."""
        try:
            return await self.primary.get_nepse_index()
        except (httpx.HTTPError, Exception) as e:
            logger.warning(f"Primary failed for nepse_index, trying fallback: {e}")
            if self.fallback:
                self.failed_over = True
                return await self.fallback.get_nepse_index()
            raise

    async def get_market_summary(self) -> Dict[str, Any]:
        """Get market summary, failover if needed."""
        try:
            return await self.primary.get_market_summary()
        except (httpx.HTTPError, Exception) as e:
            logger.warning(f"Primary failed for market_summary, trying fallback: {e}")
            if self.fallback:
                self.failed_over = True
                return await self.fallback.get_market_summary()
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

    async def get_sub_indices(self) -> List[Dict[str, Any]]:
        """Get sector sub-indices, failover if needed."""
        try:
            return await self.primary.get_sub_indices()
        except (httpx.HTTPError, Exception) as e:
            logger.warning(f"Primary failed for sub_indices: {e}")
            if self.fallback:
                self.failed_over = True
                return await self.fallback.get_sub_indices()
            raise

    async def get_top_gainers(self) -> List[Dict[str, Any]]:
        """Get top gainers, failover if needed."""
        try:
            return await self.primary.get_top_gainers()
        except (httpx.HTTPError, Exception) as e:
            logger.warning(f"Primary failed for top_gainers: {e}")
            if self.fallback:
                self.failed_over = True
                return await self.fallback.get_top_gainers()
            raise

    async def get_top_losers(self) -> List[Dict[str, Any]]:
        """Get top losers, failover if needed."""
        try:
            return await self.primary.get_top_losers()
        except (httpx.HTTPError, Exception) as e:
            logger.warning(f"Primary failed for top_losers: {e}")
            if self.fallback:
                self.failed_over = True
                return await self.fallback.get_top_losers()
            raise

    async def get_top_turnover(self) -> List[Dict[str, Any]]:
        """Get top turnover scrips, failover if needed."""
        try:
            return await self.primary.get_top_turnover()
        except (httpx.HTTPError, Exception) as e:
            logger.warning(f"Primary failed for top_turnover: {e}")
            if self.fallback:
                self.failed_over = True
                return await self.fallback.get_top_turnover()
            raise

    async def get_company_list(self) -> List[Dict[str, Any]]:
        """Get company list, failover if needed."""
        try:
            return await self.primary.get_company_list()
        except (httpx.HTTPError, Exception) as e:
            logger.warning(f"Primary failed for company_list: {e}")
            if self.fallback:
                self.failed_over = True
                return await self.fallback.get_company_list()
            raise
