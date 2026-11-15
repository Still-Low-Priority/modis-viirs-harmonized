import math
from datetime import date, datetime
from typing import Any
import logging
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.firms.client import FIRMSClient
from app.integrations.firms.enums import FIRMSProduct
from app.integrations.firms.parser import parse_firms_csv
from app.integrations.firms.availability import FIRMSDateRange, parse_data_availability
from app.integrations.firms.normalizer import normalize_firms_record
from app.integrations.firms.validator import validate_firms_records
from app.models.ingestion_batches import IngestionBatch
from app.repositories.ingestion_batches import create_ingestion_batch, mark_batch_running, complete_ingestion_batch, fail_ingestion_batch
from app.repositories.fire_detections import insert_fire_detections
from app.integrations.firms.persistence import prepare_detection_records
from app.integrations.firms.planner import plan_ingestion

logger = logging.getLogger(__name__)

# FIRMS reports some errors (invalid MAP_KEY, exceeded transaction limit)
# as a plain-text body. Without this check such a body parses as a CSV
# with zero rows and the period is recorded as successfully ingested.
REQUIRED_AREA_CSV_HEADERS = frozenset(
    {"latitude", "longitude", "acq_date", "acq_time"}
)

def ensure_area_csv_headers(csv_text: str) -> None:
    header_line = csv_text.lstrip().splitlines()[0] if csv_text.strip() else ""
    headers = {header.strip() for header in header_line.split(",")}

    if not REQUIRED_AREA_CSV_HEADERS <= headers:
        raise ValueError(
            f"Unexpected FIRMS area response: {header_line[:200]!r}"
        )

def build_bbox_parts(
    *,
    west: float,
    south: float,
    east: float,
    north: float,
) -> list[tuple[float, float, float, float]]:
    coordinates = (west, south, east, north)

    if any(
        isinstance(value, bool) or not isinstance(value, (int, float))
        for value in coordinates
    ):
        raise TypeError("Bbox coordinates must be numeric.")
    if not all(math.isfinite(value) for value in coordinates):
        raise ValueError("Bbox coordinates must be finite.")

    if not (-180 <= west <= 180 and -180 <= east <= 180):
        raise ValueError("Longitude must be between -180 and 180.")

    if not (-90 <= south < north <= 90):
        raise ValueError("Invalid latitude range.")

    if west == east:
        raise ValueError("Bbox must have a non-zero longitude range.")

    if west < east:
        return [(west, south, east, north)]

    # The bbox crosses the antimeridian.
    parts = []

    if west < 180:
        parts.append((west, south, 180, north))

    if east > -180:
        parts.append((-180, south, east, north))

    if not parts:
        raise ValueError("Bbox has no non-zero area.")

    return parts

async def fetch_period_records(
    client: FIRMSClient,
    source: FIRMSProduct,
    bbox_parts: list[tuple[float, float, float, float]],
    start_date: date,
    end_date: date,
) -> list[dict[str, str | None]]:
    day_range = (end_date - start_date).days + 1
    records = []

    for west, south, east, north in bbox_parts:
        csv_text = await client.get_area_csv(
            source=source,
            west=west,
            south=south,
            east=east,
            north=north,
            day_range=day_range,
            start_date=start_date,
        )

        ensure_area_csv_headers(csv_text)
        records.extend(parse_firms_csv(csv_text))

    return records

def normalize_and_validate_records(
    records: list[dict[str, str | None]],
    source: FIRMSProduct,
) -> tuple[list[dict[str, Any]], int]:
    normalized_records = []
    normalization_rejected = 0

    for record in records:
        try:
            normalized_records.append(
                normalize_firms_record(record, source)
            )
        except (KeyError, TypeError, ValueError, OverflowError):
            normalization_rejected += 1

    valid_records, validation_rejected = validate_firms_records(
        normalized_records
    )

    rejected_count = normalization_rejected + len(validation_rejected)

    return valid_records, rejected_count

async def run_ingestion(
    session: AsyncSession,
    client: FIRMSClient,
    source: FIRMSProduct,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    start_date: date,
    end_date: date,
    area_id: int | None = None
) -> dict[str, int]:
    """Returns how many batches were processed and how many of them failed."""
    if (
        isinstance(start_date, datetime)
        or not isinstance(start_date, date)
        or isinstance(end_date, datetime)
        or not isinstance(end_date, date)
    ):
        raise TypeError("start_date and end_date must be dates.")

    if start_date > end_date:
        raise ValueError("start_date cannot be later than end_date.")

    bbox_parts = build_bbox_parts(
        west=west,
        south=south,
        east=east,
        north=north,
    )

    # 1. Get FIRMS data availability.
    availability_csv = await client.get_data_availability_csv()
    availability = parse_data_availability(availability_csv)

    source_range = availability.get(source)

    if source_range is None:
        raise ValueError(f"No availability information for {source.value}.")

    # Restrict planning to the requested date range.
    effective_start = max(start_date, source_range.min_date)
    effective_end = min(end_date, source_range.max_date)

    if effective_start > effective_end:
        return {"batches_total": 0, "batches_failed": 0}

    requested_availability = {
        source: FIRMSDateRange(
            min_date=effective_start,
            max_date=effective_end,
        )
    }

    # 2. Build the ingestion plan.
    planned_ranges = await plan_ingestion(
        session,
        requested_availability,
        source,
        west=west,
        south=south,
        east=east,
        north=north,
        nrt_refresh_end=source_range.max_date,
    )

    if not planned_ranges:
        await session.rollback()
        return {"batches_total": 0, "batches_failed": 0}

    batches_failed = 0

    # 3. Process every planned period independently.
    for date_from, date_to in planned_ranges:
        batch = await create_ingestion_batch(
            session,
            source,
            west=west,
            south=south,
            east=east,
            north=north,
            date_from=date_from,
            date_to=date_to,
            area_id=area_id
        )

        batch_id = batch.id

        # Persist PENDING before starting external work.
        await session.commit()

        try:
            batch = await session.get(IngestionBatch, batch_id)

            if batch is None:
                raise RuntimeError(f"Batch {batch_id} was not found.")

            # 4. Mark batch as RUNNING.
            await mark_batch_running(session, batch)
            await session.commit()

            # 5. Download and parse CSV.
            raw_records = await fetch_period_records(
                client,
                source,
                bbox_parts,
                date_from,
                date_to,
            )

            # 6. Normalize and validate.
            valid_records, records_rejected = (
                normalize_and_validate_records(raw_records, source)
            )

            # 7. Prepare records and persist them.
            prepared_records = prepare_detection_records(
                valid_records,
                batch_id,
            )

            records_inserted = await insert_fire_detections(
                session,
                prepared_records,
            )

            records_skipped = len(valid_records) - records_inserted

            batch = await session.get(IngestionBatch, batch_id)

            if batch is None:
                raise RuntimeError(f"Batch {batch_id} was not found.")

            # Update batch statistics and status.
            await complete_ingestion_batch(
                session,
                batch,
                records_received=len(raw_records),
                records_inserted=records_inserted,
                records_skipped=records_skipped,
                records_rejected=records_rejected,
            )

            await session.commit()

        except Exception as exc:
            batches_failed += 1

            # Roll back detections and unfinished batch updates.
            await session.rollback()

            logger.exception(
                "Ingestion batch %s failed.",
                batch_id,
            )

            # Save FAILED in a separate transaction.
            try:
                failed_batch = await session.get(
                    IngestionBatch,
                    batch_id,
                )

                if failed_batch is not None:
                    error_message = (
                        f"{type(exc).__name__}: {exc}"
                    )[:2000]

                    await fail_ingestion_batch(
                        session,
                        failed_batch,
                        error_message,
                    )
                    await session.commit()

            except Exception:
                await session.rollback()
                logger.exception(
                    "Could not mark ingestion batch %s as FAILED.",
                    batch_id,
                )

    return {
        "batches_total": len(planned_ranges),
        "batches_failed": batches_failed,
    }
