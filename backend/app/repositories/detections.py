from typing import Any

from sqlalchemy import Integer, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.enums import ConfidenceLevel
from app.core.filters import DetectionFilters
from app.core.geo import lon_filter
from app.models.fire_detections import FireDetection
from app.core.types import ConfidenceLabel

def confidence_rank_expression() -> Any:
    # MODIS raw confidence is numeric: 0-100.
    modis_value = cast(FireDetection.confidence_raw, Integer)

    modis_rank = case(
        (modis_value.between(80, 100), 3),
        (modis_value.between(30, 79), 2),
        (modis_value.between(0, 29), 1),
        else_=None,
    )

    # VIIRS raw confidence is l/n/h.
    viirs_value = func.lower(FireDetection.confidence_raw)

    viirs_rank = case(
        (viirs_value == "h", 3),
        (viirs_value == "n", 2),
        (viirs_value == "l", 1),
        else_=None,
    )

    return case(
        (FireDetection.instrument == "MODIS", modis_rank),
        (FireDetection.instrument == "VIIRS", viirs_rank),
        else_=None,
    )


def confidence_label_expression() -> Any:
    rank = confidence_rank_expression()

    return case(
        (rank == 3, "high"),
        (rank == 2, "nominal"),
        (rank == 1, "low"),
        else_=None,
    )


def build_detection_conditions(
    filters: DetectionFilters,
) -> list[Any]:
    conditions = [
        FireDetection.acquired_at >= filters.start_at,
        FireDetection.acquired_at <= filters.end_at,
        FireDetection.source_product.in_(
            [source.value for source in filters.sources]
        ),
    ]

    if filters.bbox is not None:
        conditions.extend([
            lon_filter(
                FireDetection.longitude,
                filters.bbox.west,
                filters.bbox.east,
            ),
            FireDetection.latitude.between(
                filters.bbox.south,
                filters.bbox.north,
            ),
        ])

    if filters.daynight is not None:
        conditions.append(
            FireDetection.daynight == filters.daynight
        )

    if filters.min_confidence is not None:
        minimum_rank = {
            ConfidenceLevel.LOW: 1,
            ConfidenceLevel.NOMINAL: 2,
            ConfidenceLevel.HIGH: 3,
        }[filters.min_confidence]

        conditions.append(
            confidence_rank_expression() >= minimum_rank
        )

    return conditions


async def get_detections_page(
    session: AsyncSession,
    filters: DetectionFilters,
    *,
    limit: int,
) -> tuple[int, list[tuple[FireDetection, ConfidenceLabel]]]:
    conditions = build_detection_conditions(filters)

    # Count all matching records before applying the limit.
    count_stmt = (
        select(func.count())
        .select_from(FireDetection)
        .where(*conditions)
    )

    total_result = await session.execute(count_stmt)
    total = total_result.scalar_one()

    # Fetch the requested page with harmonized confidence.
    stmt = (
        select(
            FireDetection,
            confidence_label_expression().label("confidence"),
        )
        .where(*conditions)
        .order_by(
            FireDetection.acquired_at.desc(),
            FireDetection.id.desc(),
        )
        .limit(limit)
    )

    result = await session.execute(stmt)

    records = [
        (row[0], row[1])
        for row in result.all()
    ]

    return total, records

async def get_detection_by_id(
    session: AsyncSession,
    detection_id: int,
) -> tuple[FireDetection, ConfidenceLabel] | None:
    stmt = (
        select(
            FireDetection,
            confidence_label_expression().label("confidence"),
        )
        .where(FireDetection.id == detection_id)
    )

    result = await session.execute(stmt)
    row = result.one_or_none()

    if row is None:
        return None

    detection, confidence = row

    return detection, confidence
