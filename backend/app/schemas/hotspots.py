from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, field_serializer


HotspotSeverity = Literal["critical", "high", "elevated"]


class HotspotItem(BaseModel):
    id: str
    lat: float
    lon: float
    radius_km: float
    bbox: tuple[float, float, float, float]
    count: int
    frp_sum: float
    frp_max: float
    first_seen: datetime
    last_seen: datetime
    by_source: dict[str, int]
    severity: HotspotSeverity

    @field_serializer("first_seen", "last_seen")
    def serialize_timestamp(self, value: datetime) -> str:
        return (
            value.astimezone(timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )


class HotspotsResponse(BaseModel):
    radius_km: float
    min_count: int
    total: int
    approximate: bool
    items: list[HotspotItem]
