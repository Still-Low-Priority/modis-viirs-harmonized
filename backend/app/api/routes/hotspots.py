from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.detection_filters import get_detection_filters
from app.core.database import get_db
from app.core.filters import DetectionFilters
from app.repositories.hotspots import get_hotspot_detections
from app.schemas.hotspots import HotspotsResponse
from app.services.hotspots import cluster_hotspots


router = APIRouter(
    prefix="/api",
    tags=["hotspots"],
)


@router.get(
    "/hotspots",
    response_model=HotspotsResponse,
)
async def read_hotspots(
    filters: DetectionFilters = Depends(get_detection_filters),
    radius_km: float = Query(default=10.0, gt=0, allow_inf_nan=False),
    min_count: int = Query(default=10, ge=1),
    limit: int = Query(default=50, ge=0),
    session: AsyncSession = Depends(get_db),
) -> HotspotsResponse:
    detections = await get_hotspot_detections(
        session,
        filters,
    )

    result = cluster_hotspots(
        detections,
        radius_km=radius_km,
        min_count=min_count,
        limit=limit,
    )

    return HotspotsResponse.model_validate(result)
