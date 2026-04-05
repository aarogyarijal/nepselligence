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

    # Server
    environment: str = "development"
    log_level: str = "INFO"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
