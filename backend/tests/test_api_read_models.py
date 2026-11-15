from datetime import date, datetime, timezone

from sqlalchemy.dialects import postgresql

from app.core.enums import ProcessingMode, TimeSeriesInterval
from app.core.filters import DetectionFilters
from app.integrations.firms.enums import FIRMSProduct
from app.repositories.timeseries import get_timeseries
from app.schemas.detections import DetectionDetailResponse


class FakeResult:
    def all(self) -> list:
        return []


class FakeSession:
    def __init__(self) -> None:
        self.statements: list = []

    async def execute(self, stmt) -> FakeResult:
        self.statements.append(stmt)
        return FakeResult()


async def test_timeseries_names_the_generated_period_column() -> None:
    session = FakeSession()
    filters = DetectionFilters(
        date_from=date(2026, 11, 12),
        date_to=date(2026, 11, 13),
        processing=ProcessingMode.NRT,
        sources=(FIRMSProduct.VIIRS_NOAA20_NRT,),
    )

    await get_timeseries(session, filters, interval=TimeSeriesInterval.DAY)

    sql = str(session.statements[0].compile(dialect=postgresql.dialect()))

    # Without the column list PostgreSQL has no "periods.period" to select.
    assert "AS periods(period)" in sql


def test_detection_detail_accepts_nrt_rows_without_a_detection_type() -> None:
    detail = DetectionDetailResponse(
        id=1,
        latitude=11.9,
        longitude=6.1,
        acquired_at=datetime(2026, 11, 13, 13, 46, tzinfo=timezone.utc),
        source_product="VIIRS_NOAA20_NRT",
        satellite="N20",
        instrument="VIIRS",
        confidence="nominal",
        confidence_raw="n",
        detection_type=None,
        frp=2.15,
        brightness=None,
        bright_t31=None,
        bright_ti4=330.1,
        bright_ti5=290.4,
        scan=0.4,
        track=0.4,
        daynight="D",
        version="2.0NRT",
    )

    assert detail.model_dump(mode="json")["detection_type"] is None
