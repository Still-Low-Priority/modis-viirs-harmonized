from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.detection_filters import get_detection_filters
from app.core.database import get_db
from app.core.enums import TimeSeriesInterval
from app.core.filters import DetectionFilters
from app.repositories.timeseries import get_timeseries
from app.schemas.timeseries import (
    TimeSeriesItem,
    TimeSeriesResponse,
)


router = APIRouter(
    prefix="/api/stats",
    tags=["statistics"],
)


@router.get(
    "/timeseries",
    response_model=TimeSeriesResponse,
    response_model_exclude_none=True,
)
async def read_timeseries(
    filters: DetectionFilters = Depends(get_detection_filters),
    interval: TimeSeriesInterval = Query(
        default=TimeSeriesInterval.DAY,
    ),
    group_by: Literal["source"] | None = Query(default=None),
    session: AsyncSession = Depends(get_db),
) -> TimeSeriesResponse:
    raw_items = await get_timeseries(
        session,
        filters,
        interval=interval,
        group_by_source=group_by == "source",
    )

    items = [
        TimeSeriesItem.model_validate(item)
        for item in raw_items
    ]

    return TimeSeriesResponse(
        interval=interval,
        items=items,
    )
