import math
from datetime import date

from fastapi import HTTPException, Query

from app.core.enums import ConfidenceLevel, DayNight, ProcessingMode
from app.core.filters import BoundingBox, DetectionFilters
from app.integrations.firms.enums import FIRMSProduct


def parse_bbox(value: str | None) -> BoundingBox | None:
    if value is None:
        return None

    parts = value.split(",")

    if len(parts) != 4:
        raise HTTPException(
            status_code=422,
            detail="bbox must contain west,south,east,north.",
        )

    try:
        west, south, east, north = (
            float(part.strip()) for part in parts
        )
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="bbox coordinates must be numeric.",
        ) from None

    if not all(
        math.isfinite(value)
        for value in (west, south, east, north)
    ):
        raise HTTPException(
            status_code=422,
            detail="bbox coordinates must be finite.",
        )

    if not (
        -180 <= west <= 180
        and -180 <= east <= 180
        and -90 <= south < north <= 90
        and west != east
    ):
        raise HTTPException(
            status_code=422,
            detail="Invalid bbox coordinates.",
        )

    return BoundingBox(
        west=west,
        south=south,
        east=east,
        north=north,
    )


def get_detection_filters(
    date_from: date,
    date_to: date,
    processing: ProcessingMode = Query(
        default=ProcessingMode.SP,
    ),
    source: list[FIRMSProduct] | None = Query(
        default=None,
    ),
    bbox: str | None = Query(default=None),
    daynight: DayNight | None = Query(default=None),
    min_confidence: ConfidenceLevel | None = Query(
        default=None,
    ),
) -> DetectionFilters:
    if date_from > date_to:
        raise HTTPException(
            status_code=422,
            detail="date_from cannot be later than date_to.",
        )

    expected_suffix = (
        "_NRT" if processing == ProcessingMode.NRT else "_SP"
    )

    if source is None:
        selected_sources = tuple(
            product
            for product in FIRMSProduct
            if product.value.endswith(expected_suffix)
        )
    else:
        incompatible_sources = [
            product.value
            for product in source
            if not product.value.endswith(expected_suffix)
        ]

        if incompatible_sources:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": (
                        "Source products must match the selected "
                        "processing mode."
                    ),
                    "incompatible_sources": incompatible_sources,
                },
            )

        selected_sources = tuple(dict.fromkeys(source))

    return DetectionFilters(
        date_from=date_from,
        date_to=date_to,
        processing=processing,
        sources=selected_sources,
        bbox=parse_bbox(bbox),
        daynight=daynight,
        min_confidence=min_confidence,
    )
