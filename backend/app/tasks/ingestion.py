import asyncio
from datetime import date

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.settings import get_database_settings, get_firms_settings
from app.integrations.firms.client import FIRMSClient
from app.integrations.firms.enums import FIRMSProduct
from app.integrations.firms.pipeline import run_ingestion
from app.celery_app import celery_app


async def _run_ingestion_async(
    source: FIRMSProduct,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    start_date: date,
    end_date: date,
    area_id: int | None = None,
) -> None:
    database_url = (
        get_database_settings().DATABASE_URL.get_secret_value()
    )
    firms_map_key = get_firms_settings().FIRMS_MAP_KEY

    engine = create_async_engine(
        database_url,
        poolclass=NullPool,
    )

    session_factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
    )

    try:
        async with session_factory() as session:
            async with FIRMSClient(firms_map_key) as client:
                await run_ingestion(
                    session,
                    client,
                    source,
                    west=west,
                    south=south,
                    east=east,
                    north=north,
                    start_date=start_date,
                    end_date=end_date,
                    area_id=area_id,
                )
    finally:
        await engine.dispose()


@celery_app.task(
    name="app.tasks.ingestion.run_firms_ingestion",
)
def run_firms_ingestion_task(
    source: str,
    west: float,
    south: float,
    east: float,
    north: float,
    start_date: str,
    end_date: str,
    area_id: int | None = None,
) -> dict[str, str]:
    product = FIRMSProduct(source)

    period_start = date.fromisoformat(start_date)
    period_end = date.fromisoformat(end_date)

    asyncio.run(
        _run_ingestion_async(
            product,
            west=west,
            south=south,
            east=east,
            north=north,
            start_date=period_start,
            end_date=period_end,
            area_id=area_id,
        )
    )

    return {
        "source": product.value,
        "start_date": start_date,
        "end_date": end_date,
        "message": "Pipeline execution finished.",
    }
