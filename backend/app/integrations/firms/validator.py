from datetime import datetime, timedelta
from math import isfinite
from typing import Any

from app.core.enums import DayNight
from app.integrations.firms.enums import FIRMSProduct


MODIS_PRODUCTS = {
    FIRMSProduct.MODIS_NRT,
    FIRMSProduct.MODIS_SP,
}

VIIRS_PRODUCTS = {
    FIRMSProduct.VIIRS_NOAA20_NRT,
    FIRMSProduct.VIIRS_NOAA20_SP,
    FIRMSProduct.VIIRS_NOAA21_NRT,
    FIRMSProduct.VIIRS_NOAA21_SP,
    FIRMSProduct.VIIRS_SNPP_NRT,
    FIRMSProduct.VIIRS_SNPP_SP,
}

NUMERIC_FIELDS = (
    "brightness",
    "bright_t31",
    "bright_ti4",
    "bright_ti5",
    "scan",
    "track",
    "frp",
)


def validate_firms_record(record: dict[str, Any]) -> list[str]:
    errors = []

    # Source product
    try:
        source = FIRMSProduct(record.get("source_product"))
    except (ValueError, TypeError):
        source = None
        errors.append("Invalid source_product.")

    # Required string fields
    for field in ("satellite", "instrument", "confidence_raw", "version"):
        value = record.get(field)

        if not isinstance(value, str) or not value.strip():
            errors.append(f"Invalid or missing {field}.")

    # Instrument consistency
    instrument = record.get("instrument")

    if source in MODIS_PRODUCTS and instrument != "MODIS":
        errors.append("Instrument does not match MODIS product.")

    elif source in VIIRS_PRODUCTS and instrument != "VIIRS":
        errors.append("Instrument does not match VIIRS product.")

    # Coordinates
    for field, minimum, maximum in (
        ("latitude", -90, 90),
        ("longitude", -180, 180),
    ):
        value = record.get(field)

        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not isfinite(value)
            or not minimum <= value <= maximum
        ):
            errors.append(f"Invalid {field}.")

    # Acquired datetime
    acquired_at = record.get("acquired_at")

    if not isinstance(acquired_at, datetime):
        errors.append("Invalid acquired_at.")
    elif (
        acquired_at.tzinfo is None
        or acquired_at.utcoffset() != timedelta(0)
    ):
        errors.append("acquired_at must be timezone-aware UTC.")

    # Confidence
    confidence = record.get("confidence_raw")

    if isinstance(confidence, str):
        if source in MODIS_PRODUCTS:
            try:
                confidence_value = int(confidence)
                if not 0 <= confidence_value <= 100:
                    errors.append("MODIS confidence must be between 0 and 100.")
            except ValueError:
                errors.append("MODIS confidence must be numeric.")

        elif source in VIIRS_PRODUCTS:
            if confidence.lower() not in {"l", "n", "h"}:
                errors.append("Invalid VIIRS confidence value.")

    # Day/Night
    if not isinstance(record.get("daynight"), DayNight):
        errors.append("Invalid daynight value.")

    # Optional numeric fields
    for field in NUMERIC_FIELDS:
        value = record.get(field)

        if value is None:
            continue

        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not isfinite(value)
        ):
            errors.append(f"Invalid numeric field: {field}.")
            continue

        if field == "frp" and value < 0:
            errors.append("FRP cannot be negative.")

        if field in {"scan", "track"} and value <= 0:
            errors.append(f"{field} must be greater than zero.")

        if field in {"brightness", "bright_t31", "bright_ti4", "bright_ti5"} and value < 0:
            errors.append(f"{field} cannot be negative.")

    return errors


def validate_firms_records(
    records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:

    valid_records = []
    rejected_records = []

    for record in records:
        errors = validate_firms_record(record)

        if errors:
            rejected_records.append({
                "record": record,
                "errors": errors,
            })
        else:
            valid_records.append(record)

    return valid_records, rejected_records
