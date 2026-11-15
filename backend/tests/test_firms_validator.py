from datetime import datetime

import pytest

from app.core.enums import DayNight
from app.integrations.firms.enums import FIRMSProduct
from app.integrations.firms.validator import validate_firms_record, validate_firms_records


def test_accepts_valid_modis_record(valid_normalized_record: dict[str, object]) -> None:
    assert validate_firms_record(valid_normalized_record) == []


@pytest.mark.parametrize("field,value", [("latitude", -90.1), ("latitude", True), ("longitude", 180.1), ("longitude", float("nan"))])
def test_rejects_invalid_coordinates(valid_normalized_record: dict[str, object], field: str, value: object) -> None:
    assert f"Invalid {field}." in validate_firms_record(valid_normalized_record | {field: value})


@pytest.mark.parametrize("confidence,error", [("101", "MODIS confidence must be between 0 and 100."), ("high", "MODIS confidence must be numeric.")])
def test_validates_modis_confidence(valid_normalized_record: dict[str, object], confidence: str, error: str) -> None:
    assert error in validate_firms_record(valid_normalized_record | {"confidence_raw": confidence})


@pytest.mark.parametrize("confidence", ["l", "N", "h"])
def test_accepts_viirs_confidence_case_insensitively(valid_normalized_record: dict[str, object], confidence: str) -> None:
    record = valid_normalized_record | {"source_product": FIRMSProduct.VIIRS_NOAA20_NRT.value, "instrument": "VIIRS", "confidence_raw": confidence}
    assert validate_firms_record(record) == []


def test_rejects_invalid_viirs_confidence(valid_normalized_record: dict[str, object]) -> None:
    record = valid_normalized_record | {"source_product": FIRMSProduct.VIIRS_SNPP_SP.value, "instrument": "VIIRS", "confidence_raw": "medium"}
    assert "Invalid VIIRS confidence value." in validate_firms_record(record)


@pytest.mark.parametrize("field,value,error", [("frp", -0.1, "FRP cannot be negative."), ("scan", 0.0, "scan must be greater than zero."), ("track", float("inf"), "Invalid numeric field: track."), ("brightness", -1.0, "brightness cannot be negative."), ("frp", True, "Invalid numeric field: frp.")])
def test_validates_optional_numeric_fields(valid_normalized_record: dict[str, object], field: str, value: object, error: str) -> None:
    assert error in validate_firms_record(valid_normalized_record | {field: value})


def test_rejects_naive_datetime_missing_string_and_invalid_daynight(valid_normalized_record: dict[str, object]) -> None:
    record = valid_normalized_record | {"acquired_at": datetime(2026, 1, 2), "satellite": None, "daynight": "D"}
    errors = validate_firms_record(record)
    assert "acquired_at must be timezone-aware UTC." in errors
    assert "Invalid or missing satellite." in errors
    assert "Invalid daynight value." in errors


def test_separates_valid_and_rejected_records(valid_normalized_record: dict[str, object]) -> None:
    valid, rejected = validate_firms_records([valid_normalized_record, valid_normalized_record | {"daynight": DayNight.DAY, "frp": -1.0}])
    assert valid == [valid_normalized_record]
    assert rejected[0]["record"]["frp"] == -1.0
