from pydantic import BaseModel

from app.core.enums import TimeSeriesInterval


class TimeSeriesItem(BaseModel):
    period: str
    count: int
    frp_sum: float
    by_source: dict[str, int] | None = None


class TimeSeriesResponse(BaseModel):
    interval: TimeSeriesInterval
    items: list[TimeSeriesItem]
