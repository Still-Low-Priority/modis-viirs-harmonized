from functools import lru_cache
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
    DATABASE_URL: str

@lru_cache()
def get_database_settings() -> DatabaseSettings:
    return DatabaseSettings()
