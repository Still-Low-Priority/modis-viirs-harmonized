from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.enums import BatchStatus
from app.models.fire_detections import FireDetection
from app.models.ingestion_batches import IngestionBatch


def _utc_date(value: datetime) -> date:
    return value.astimezone(timezone.utc).date()


async def get_source_metadata(
    session: AsyncSession,
) -> dict:
    stmt = (
        select(
            FireDetection.source_product,
            FireDetection.instrument,
            FireDetection.satellite,
            func.min(FireDetection.acquired_at).label("first_seen"),
            func.max(FireDetection.acquired_at).label("last_seen"),
        )
        .group_by(
            FireDetection.source_product,
            FireDetection.instrument,
            FireDetection.satellite,
        )
        .order_by(
            FireDetection.source_product,
            FireDetection.satellite,
        )
    )

    result = await session.execute(stmt)
    rows = result.all()

    grouped_sources = {}

    for row in rows:
        key = (row.source_product, row.instrument)

        if key not in grouped_sources:
            grouped_sources[key] = {
                "source_product": row.source_product,
                "processing": (
                    "NRT"
                    if row.source_product.endswith("_NRT")
                    else "SP"
                ),
                "instrument": row.instrument,
                "satellites": set(),
                "date_min": None,
                "date_max": None,
            }

        source = grouped_sources[key]

        source["satellites"].add(row.satellite)

        row_min = _utc_date(row.first_seen)
        row_max = _utc_date(row.last_seen)

        if source["date_min"] is None:
            source["date_min"] = row_min
            source["date_max"] = row_max
        else:
            source["date_min"] = min(
                source["date_min"],
                row_min,
            )
            source["date_max"] = max(
                source["date_max"],
                row_max,
            )

    sources = []

    for source in grouped_sources.values():
        source["satellites"] = sorted(source["satellites"])
        sources.append(source)

    sources.sort(key=lambda item: item["source_product"])

    if sources:
        global_date_min = min(
            source["date_min"] for source in sources
        )
        global_date_max = max(
            source["date_max"] for source in sources
        )
    else:
        global_date_min = None
        global_date_max = None

    return {
        "sources": sources,
        "date_min": global_date_min,
        "date_max": global_date_max,
    }


async def get_last_ingested_at(
    session: AsyncSession,
) -> datetime | None:
    stmt = select(
        func.max(IngestionBatch.finished_at)
    ).where(
        IngestionBatch.status == BatchStatus.COMPLETED
    )

    result = await session.execute(stmt)

    last_ingested_at = result.scalar_one_or_none()

    if last_ingested_at is not None:
        return last_ingested_at.astimezone(timezone.utc)

    return None
