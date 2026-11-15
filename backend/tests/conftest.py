from datetime import datetime, timezone

import pytest

from app.core.enums import DayNight
from app.integrations.firms.enums import FIRMSProduct


@pytest.fixture
def valid_normalized_record() -> dict[str, object]:
    return {
        "source_product": FIRMSProduct.MODIS_NRT.value,
        "latitude": 49.0,
        "longitude": 31.0,
        "acquired_at": datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc),
        "satellite": "Terra",
        "instrument": "MODIS",
        "confidence_raw": "80",
        "detection_type": None,
        "brightness": 320.0,
        "bright_t31": None,
        "bright_ti4": None,
        "bright_ti5": None,
        "scan": 1.0,
        "track": 1.0,
        "frp": 12.5,
        "daynight": DayNight.DAY,
        "version": "6.1NRT",
    }


@pytest.fixture
def valid_csv_record() -> dict[str, str | None]:
    return {
        "latitude": "49.0",
        "longitude": "31.0",
        "acq_date": "2026-01-02",
        "acq_time": "304",
        "satellite": "Terra",
        "instrument": "MODIS",
        "confidence": "80",
        "brightness": "320.5",
        "bright_t31": "",
        "bright_ti4": None,
        "bright_ti5": "",
        "scan": "1.0",
        "track": "1.0",
        "frp": "12.5",
        "daynight": "D",
        "version": "6.1NRT",
    }
