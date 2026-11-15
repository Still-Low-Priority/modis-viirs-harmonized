from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.detection_filters import get_detection_filters
from app.core.database import get_db
from app.core.filters import DetectionFilters
from app.repositories.detections import (
    get_detection_by_id,
    get_detections_page,
)
from app.schemas.detections import (
    DetectionDetailResponse,
    DetectionFeature,
    DetectionProperties,
    DetectionsResponse,
    PointGeometry,
)
from app.repositories.grid import get_detection_grid
from app.schemas.grid import GridCell

router = APIRouter(
    prefix="/api",
    tags=["detections"],
)


@router.get(
    "/detections",
    response_model=DetectionsResponse,
)
async def list_detections(
    filters: DetectionFilters = Depends(get_detection_filters),
    limit: int = Query(default=5000, ge=1, le=20000),
    session: AsyncSession = Depends(get_db),
) -> DetectionsResponse:
    total, records = await get_detections_page(
        session,
        filters,
        limit=limit,
    )

    features = []

    for detection, confidence in records:
        features.append(
            DetectionFeature(
                id=detection.id,
                geometry=PointGeometry(
                    coordinates=(
                        detection.longitude,
                        detection.latitude,
                    ),
                ),
                properties=DetectionProperties(
                    acquired_at=detection.acquired_at,
                    source_product=detection.source_product,
                    instrument=detection.instrument,
                    confidence=confidence,
                    frp=detection.frp,
                    daynight=detection.daynight.value,
                ),
            )
        )

    return DetectionsResponse(
        total=total,
        truncated=total > len(features),
        features=features,
    )

@router.get(
    "/detections/grid",
    response_model=list[GridCell],
)
async def read_detection_grid(
    filters: DetectionFilters = Depends(get_detection_filters),
    cell: float = Query(
        gt=0,
        le=180,
        allow_inf_nan=False,
    ),
    session: AsyncSession = Depends(get_db),
) -> list[GridCell]:
    records = await get_detection_grid(
        session,
        filters,
        cell=cell,
    )

    return [
        GridCell.model_validate(record)
        for record in records
    ]

@router.get(
    "/detections/{detection_id}",
    response_model=DetectionDetailResponse,
    responses={
        404: {"description": "Detection not found"},
    },
)
async def read_detection(
    detection_id: int = Path(ge=1),
    session: AsyncSession = Depends(get_db),
) -> DetectionDetailResponse:
    record = await get_detection_by_id(
        session,
        detection_id,
    )

    if record is None:
        raise HTTPException(
            status_code=404,
            detail="Detection not found",
        )

    detection, confidence = record

    return DetectionDetailResponse(
        id=detection.id,
        latitude=detection.latitude,
        longitude=detection.longitude,
        acquired_at=detection.acquired_at,
        source_product=detection.source_product,
        satellite=detection.satellite,
        instrument=detection.instrument,
        confidence=confidence,
        confidence_raw=detection.confidence_raw,
        detection_type=detection.detection_type,
        frp=detection.frp,
        brightness=detection.brightness,
        bright_t31=detection.bright_t31,
        bright_ti4=detection.bright_ti4,
        bright_ti5=detection.bright_ti5,
        scan=detection.scan,
        track=detection.track,
        daynight=detection.daynight.value,
        version=detection.version,
    )
