from datetime import date, datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
import hashlib
import struct
from sqlalchemy import select, text

from app.core.enums import BatchStatus
from app.integrations.firms.enums import FIRMSProduct
from app.models.ingestion_batches import IngestionBatch

def build_ingestion_lock_keys(
    source: FIRMSProduct,
    *,
    area_id: int | None,
    west: float,
    south: float,
    east: float,
    north: float,
) -> tuple[int, int]:
    scope = "\0".join([
        source.value,
        str(area_id) if area_id is not None else "NULL",
        *(float(value).hex() for value in (
            west,
            south,
            east,
            north,
        )),
    ])

    digest = hashlib.sha256(scope.encode("utf-8")).digest()

    return struct.unpack("!ii", digest[:8])


async def acquire_ingestion_scope_lock(
    session: AsyncSession,
    source: FIRMSProduct,
    *,
    area_id: int | None,
    west: float,
    south: float,
    east: float,
    north: float,
) -> None:
    key1, key2 = build_ingestion_lock_keys(
        source,
        area_id=area_id,
        west=west,
        south=south,
        east=east,
        north=north,
    )

    await session.execute(
        text("SELECT pg_advisory_xact_lock(:key1, :key2)"),
        {
            "key1": key1,
            "key2": key2,
        },
    )

async def get_existing_batch_ranges(
    session: AsyncSession,
    source: FIRMSProduct,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    area_id: int | None = None
) -> list[tuple[date, date]]:
    stmt = (
        select(IngestionBatch.date_from, IngestionBatch.date_to)
        .where(
            IngestionBatch.source_product == source.value,
            IngestionBatch.west == west,
            IngestionBatch.south == south,
            IngestionBatch.east == east,
            IngestionBatch.north == north,
            IngestionBatch.area_id == area_id,
            IngestionBatch.status.in_([
                BatchStatus.COMPLETED,
                BatchStatus.PENDING,
                BatchStatus.RUNNING,
            ]),
        )
        .order_by(IngestionBatch.date_from)
    )

    result = await session.execute(stmt)
    return [(row[0], row[1]) for row in result.all()]

async def create_ingestion_batch(
    session: AsyncSession,
    source: FIRMSProduct,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    date_from: date,
    date_to: date,
    area_id: int | None = None,
) -> IngestionBatch:
    batch = IngestionBatch(
        source_product=source.value,
        area_id=area_id,
        west=west,
        south=south,
        east=east,
        north=north,
        date_from=date_from,
        date_to=date_to,
        status=BatchStatus.PENDING,
    )

    session.add(batch)
    await session.flush()

    return batch

async def mark_batch_running(
    session: AsyncSession,
    batch: IngestionBatch,
) -> None:
    batch.status = BatchStatus.RUNNING
    batch.started_at = datetime.now(timezone.utc)

    await session.flush()

async def complete_ingestion_batch(
    session: AsyncSession,
    batch: IngestionBatch,
    *,
    records_received: int,
    records_inserted: int,
    records_skipped: int,
    records_rejected: int,
) -> None:
    batch.records_received = records_received
    batch.records_inserted = records_inserted
    batch.records_skipped = records_skipped
    batch.records_rejected = records_rejected

    batch.status = (
        BatchStatus.PARTIAL if records_rejected > 0
        else BatchStatus.COMPLETED
    )
    batch.finished_at = datetime.now(timezone.utc)

    await session.flush()

async def fail_ingestion_batch(
    session: AsyncSession,
    batch: IngestionBatch,
    error_message: str,
) -> None:
    batch.status = BatchStatus.FAILED
    batch.error_message = error_message
    batch.finished_at = datetime.now(timezone.utc)

    await session.flush()

async def get_active_batch_ranges(
    session: AsyncSession,
    source: FIRMSProduct,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    area_id: int | None = None
) -> list[tuple[date, date]]:
    stmt = (
        select(IngestionBatch.date_from, IngestionBatch.date_to)
        .where(
            IngestionBatch.source_product == source.value,
            IngestionBatch.west == west,
            IngestionBatch.south == south,
            IngestionBatch.east == east,
            IngestionBatch.north == north,
            IngestionBatch.area_id == area_id,
            IngestionBatch.status.in_([
                BatchStatus.PENDING,
                BatchStatus.RUNNING,
            ]),
        )
        .order_by(IngestionBatch.date_from)
    )

    result = await session.execute(stmt)

    return [
        (row.date_from, row.date_to)
        for row in result.all()
    ]
