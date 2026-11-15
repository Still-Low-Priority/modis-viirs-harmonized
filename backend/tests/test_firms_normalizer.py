from datetime import datetime, timezone

import pytest

from app.core.enums import DayNight
from app.integrations.firms.enums import FIRMSProduct
from app.integrations.firms.normalizer import (
    normalize_firms_record,
    normalize_firms_records,
    parse_acquired_at,
    parse_optional_float,
)


def test_normalizes_modis_record_with_nullable_values(valid_csv_record: dict[str, str | None]) -> None:
    record = normalize_firms_record(valid_csv_record, FIRMSProduct.MODIS_NRT)

    assert record["source_product"] == "MODIS_NRT"
    assert record["acquired_at"] == datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc)
    assert record["brightness"] == 320.5
    assert record["bright_t31"] is None
    assert record["daynight"] is DayNight.DAY


@pytest.mark.parametrize("product", [
    FIRMSProduct.VIIRS_NOAA20_NRT,
    FIRMSProduct.VIIRS_NOAA20_SP,
    FIRMSProduct.VIIRS_NOAA21_NRT,
    FIRMSProduct.VIIRS_NOAA21_SP,
    FIRMSProduct.VIIRS_SNPP_NRT,
    FIRMSProduct.VIIRS_SNPP_SP,
])
def test_normalizes_every_supported_viirs_product(
    valid_csv_record: dict[str, str | None], product: FIRMSProduct
) -> None:
    viirs_record = valid_csv_record | {"instrument": "VIIRS", "confidence": "h"}

    normalized = normalize_firms_record(viirs_record, product)

    assert normalized["source_product"] == product.value
    assert normalized["instrument"] == "VIIRS"
    assert normalized["confidence_raw"] == "h"


def test_parse_acquired_at_zero_pads_time_and_returns_utc() -> None:
    assert parse_acquired_at("2026-01-02", "5") == datetime(2026, 1, 2, 0, 5, tzinfo=timezone.utc)


@pytest.mark.parametrize("value", [None, "", "   "])
def test_optional_float_accepts_missing_values(value: str | None) -> None:
    assert parse_optional_float(value) is None


@pytest.mark.parametrize("field,value", [("latitude", ""), ("acq_date", "not-a-date"), ("daynight", "X"), ("frp", "nope")])
def test_rejects_invalid_required_or_numeric_csv_values(
    valid_csv_record: dict[str, str | None], field: str, value: str
) -> None:
    with pytest.raises(ValueError):
        normalize_firms_record(valid_csv_record | {field: value}, FIRMSProduct.MODIS_NRT)


def test_normalizes_a_collection(valid_csv_record: dict[str, str | None]) -> None:
    records = normalize_firms_records([valid_csv_record, valid_csv_record], FIRMSProduct.MODIS_NRT)

    assert len(records) == 2
