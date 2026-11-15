from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.filters import DetectionFilters
from app.models.fire_detections import FireDetection
from app.repositories.detections import build_detection_conditions
from app.services.hotspots import HotspotDetection


async def get_hotspot_detections(
    session: AsyncSession,
    filters: DetectionFilters,
) -> list[HotspotDetection]:
    stmt = (
        select(
            FireDetection.id,
            FireDetection.latitude,
            FireDetection.longitude,
            FireDetection.acquired_at,
            FireDetection.source_product,
            FireDetection.frp,
        )
        .where(*build_detection_conditions(filters))
        .order_by(FireDetection.id)
        .execution_options(yield_per=5000)
    )

    result = await session.stream(stmt)
    detections: list[HotspotDetection] = []

    try:
        async for row in result:
            detections.append(
                HotspotDetection(
                    id=row.id,
                    latitude=row.latitude,
                    longitude=row.longitude,
                    acquired_at=row.acquired_at,
                    source_product=row.source_product,
                    frp=row.frp,
                )
            )
    finally:
        await result.close()

    return detections
