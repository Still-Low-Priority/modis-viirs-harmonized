from typing import Any

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.filters import DetectionFilters
from app.models.fire_detections import FireDetection
from app.repositories.detections import build_detection_conditions


async def get_detection_grid(
    session: AsyncSession,
    filters: DetectionFilters,
    *,
    cell: float,
) -> list[dict[str, Any]]:
    latitude_index = cast(
        func.floor(FireDetection.latitude / cell),
        Integer,
    )

    longitude_index = cast(
        func.floor(FireDetection.longitude / cell),
        Integer,
    )

    stmt = (
        select(
            latitude_index.label("latitude_index"),
            longitude_index.label("longitude_index"),
            func.count(FireDetection.id).label("count"),
            func.coalesce(
                func.sum(FireDetection.frp),
                0.0,
            ).label("frp_sum"),
        )
        .where(*build_detection_conditions(filters))
        .group_by(
            latitude_index,
            longitude_index,
        )
        .order_by(
            latitude_index,
            longitude_index,
        )
    )

    result = await session.execute(stmt)

    cells: list[dict[str, Any]] = []

    for row in result:
        lat = (row.latitude_index + 0.5) * cell
        lon = (row.longitude_index + 0.5) * cell

        cells.append(
            {
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "count": row.count,
                "frp_sum": round(float(row.frp_sum), 1),
            }
        )

    return cells
