import asyncio
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.settings import get_database_settings, get_firms_settings
from app.integrations.firms.availability import parse_data_availability
from app.integrations.firms.client import FIRMSClient
from app.integrations.firms.enums import FIRMSProduct
from app.repositories.areas import get_all_areas
from app.celery_app import celery_app


logger = logging.getLogger(__name__)


NRT_PRODUCTS = (
    FIRMSProduct.MODIS_NRT,
    FIRMSProduct.VIIRS_NOAA20_NRT,
    FIRMSProduct.VIIRS_NOAA21_NRT,
    FIRMSProduct.VIIRS_SNPP_NRT,
)


async def _build_nrt_ingestion_jobs() -> tuple[list[dict[str, Any]], int, int]:
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
            areas = await get_all_areas(session)

            # Copy ORM values before closing the session.
            area_data = [
                {
                    "area_id": area.id,
                    "west": area.west,
                    "south": area.south,
                    "east": area.east,
                    "north": area.north,
                }
                for area in areas
            ]

        if not area_data:
            logger.info("No areas configured for NRT ingestion.")
            return [], 0, 0

        async with FIRMSClient(firms_map_key) as client:
            availability_csv = await client.get_data_availability_csv()

        availability = parse_data_availability(availability_csv)

        jobs = []
        products_available = 0

        for source in NRT_PRODUCTS:
            source_range = availability.get(source)

            if source_range is None:
                logger.warning(
                    "No availability information for %s.",
                    source.value,
                )
                continue

            products_available += 1

            # Refresh the last five available days, inclusive.
            end_date = source_range.max_date
            start_date = max(
                source_range.min_date,
                end_date - timedelta(days=4),
            )

            for area in area_data:
                jobs.append({
                    "source": source.value,
                    "west": area["west"],
                    "south": area["south"],
                    "east": area["east"],
                    "north": area["north"],
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat(),
                    "area_id": area["area_id"],
                })

        return jobs, len(area_data), products_available

    finally:
        await engine.dispose()


@celery_app.task(
    name="app.tasks.scheduler.schedule_nrt_ingestion",
)
def schedule_nrt_ingestion() -> dict[str, int]:
    jobs, areas_count, products_count = asyncio.run(
        _build_nrt_ingestion_jobs()
    )

    dispatched = 0

    for job in jobs:
        celery_app.send_task(
            "app.tasks.ingestion.run_firms_ingestion",
            kwargs=job,
        )
        dispatched += 1

    logger.info(
        "NRT scheduler dispatched %s jobs for %s areas and %s products.",
        dispatched,
        areas_count,
        products_count,
    )

    return {
        "areas": areas_count,
        "products": products_count,
        "tasks_dispatched": dispatched,
    }
