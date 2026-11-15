from functools import lru_cache
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

class DatabaseSettings(Settings):
    def __init__(self) -> None:
        super().__init__()
    DATABASE_URL: SecretStr

class FirmsSettings(Settings):
    def __init__(self) -> None:
        super().__init__()
    FIRMS_MAP_KEY: SecretStr

class CelerySettings(Settings):
    def __init__(self) -> None:
        super().__init__()
    CELERY_BROKER_URL: SecretStr
    CELERY_RESULT_BACKEND: SecretStr

@lru_cache()
def get_database_settings() -> DatabaseSettings:
    return DatabaseSettings()

@lru_cache()
def get_firms_settings() -> FirmsSettings:
    return FirmsSettings()

@lru_cache()
def get_celery_settings() -> CelerySettings:
    return CelerySettings()
