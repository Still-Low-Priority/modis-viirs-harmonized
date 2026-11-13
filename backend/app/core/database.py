from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.settings import get_database_settings

@lru_cache()
def get_engine() -> AsyncEngine:
    return create_async_engine(get_database_settings().DATABASE_URL)

@lru_cache()
def get_session_factory() -> async_sessionmaker:
    return async_sessionmaker(bind=get_engine(), expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with get_session_factory()() as session:
        yield session

