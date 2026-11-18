"""Configuration management."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings from environment variables."""

    # Database
    database_url: str = "postgresql://nepselligence:nepselligence@localhost:5432/nepselligence"

    # NepseAPI (self-hosted Docker)
    nepse_api_url: str = "http://localhost:8000"
    nepse_api_timeout: int = 30

    # NepseUnofficialApi
    nepse_unofficial_api_tls_verify: bool = False

    # Scheduler
    scheduler_timezone: str = "Asia/Kathmandu"
    scheduler_max_instances: int = 1

    # Claude API
    claude_api_key: str = ""
    claude_api_max_tokens: int = 2000
    claude_model_fast: str = "claude-haiku-4-5-20251001"   # for market_open + hourly insights
    claude_model_deep: str = "claude-sonnet-4-6"           # for daily_close + weekly_wrap

    # Data retention
    intraday_sector_retention_days: int = 30
    stock_price_intraday_retention_days: int = 14

    # AI memory retention
    ai_memory_observation_retention_days: int = 30
    ai_memory_regime_retention_days: int = 90
    ai_memory_weekly_summary_retention_weeks: int = 12

    # News sources. ShareSansar dropped its RSS feed in April 2026, so its
    # listing pages are scraped instead.
    news_sharesansar_pages: list[str] = [
        "https://www.sharesansar.com/category/latest",
        "https://www.sharesansar.com/category/ipo-fpo-news",
        "https://www.sharesansar.com/category/proposed-dividend",
    ]
    news_rss_onlinekhabar: str = "https://english.onlinekhabar.com/category/economy/feed"
    news_retention_days: int = 90

    # Server
    environment: str = "development"
    log_level: str = "INFO"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
