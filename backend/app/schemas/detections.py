from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, field_serializer

from app.core.types import ConfidenceLabel

class DetectionProperties(BaseModel):
    acquired_at: datetime
    source_product: str
    instrument: str
    confidence: ConfidenceLabel
    frp: float
    daynight: Literal["D", "N"]

    @field_serializer("acquired_at")
    def serialize_acquired_at(self, value: datetime) -> str:
        return (
            value.astimezone(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )


class PointGeometry(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: tuple[float, float]


class DetectionFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    id: int
    geometry: PointGeometry
    properties: DetectionProperties


class DetectionsResponse(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    total: int
    truncated: bool
    features: list[DetectionFeature]


class DetectionDetailResponse(BaseModel):
    id: int
    latitude: float
    longitude: float
    acquired_at: datetime
    source_product: str
    satellite: str
    instrument: str
    confidence: Literal["low", "nominal", "high"] | None
    confidence_raw: str
    # FIRMS sends a detection type only for Standard Processing products.
    detection_type: int | None
    frp: float
    brightness: float | None
    bright_t31: float | None
    bright_ti4: float | None
    bright_ti5: float | None
    scan: float
    track: float
    daynight: Literal["D", "N"]
    version: str

    @field_serializer("acquired_at")
    def serialize_acquired_at(self, value: datetime) -> str:
        return (
            value.astimezone(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )
