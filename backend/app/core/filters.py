from dataclasses import dataclass
from datetime import date, datetime, time, timezone

from app.core.enums import ConfidenceLevel, DayNight, ProcessingMode
from app.integrations.firms.enums import FIRMSProduct


@dataclass(frozen=True, slots=True)
class BoundingBox:
    west: float
    south: float
    east: float
    north: float


@dataclass(frozen=True, slots=True)
class DetectionFilters:
    date_from: date
    date_to: date
    processing: ProcessingMode
    sources: tuple[FIRMSProduct, ...]
    bbox: BoundingBox | None = None
    daynight: DayNight | None = None
    min_confidence: ConfidenceLevel | None = None

    @property
    def start_at(self) -> datetime:
        return datetime.combine(
            self.date_from,
            time.min,
            tzinfo=timezone.utc,
        )

    @property
    def end_at(self) -> datetime:
        return datetime.combine(
            self.date_to,
            time.max,
            tzinfo=timezone.utc,
        )
