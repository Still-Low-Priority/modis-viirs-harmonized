from datetime import datetime, timezone
from typing import Any

from app.core.enums import DayNight
from app.integrations.firms.enums import FIRMSProduct

def parse_acquired_at(
        acq_date: str,
        acq_time: str
) -> datetime:
    acq_time = acq_time.zfill(4)
    acq_datetime = f"{acq_date} {acq_time}"
    acq_datetime = datetime.strptime(acq_datetime, "%Y-%m-%d %H%M")
    return acq_datetime.replace(tzinfo=timezone.utc)

def parse_optional_float(value: str | None) -> float | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None

    return float(value)

def require_csv_value(
    record: dict[str, str | None],
    field: str,
) -> str:
    value = record.get(field)
    if value is None or not value.strip():
        raise ValueError(f"Required CSV field '{field}' is missing.")

    return value.strip()

def normalize_firms_record(
    record: dict[str, str | None],
    source: FIRMSProduct,
) -> dict[str, Any]:
    return {
        "source_product": source.value,
        "latitude": float(require_csv_value(record, "latitude")),
        "longitude": float(require_csv_value(record, "longitude")),
        "acquired_at": parse_acquired_at(
            require_csv_value(record, "acq_date"),
            require_csv_value(record, "acq_time"),
        ),
        "satellite": require_csv_value(record, "satellite"),
        "instrument": require_csv_value(record, "instrument"),
        "confidence_raw": require_csv_value(record, "confidence"),
        "detection_type": None,

        "brightness": parse_optional_float(record.get("brightness")),
        "bright_t31": parse_optional_float(record.get("bright_t31")),
        "bright_ti4": parse_optional_float(record.get("bright_ti4")),
        "bright_ti5": parse_optional_float(record.get("bright_ti5")),

        "scan": parse_optional_float(record.get("scan")),
        "track": parse_optional_float(record.get("track")),
        "frp": parse_optional_float(record.get("frp")),

        "daynight": (
            DayNight(record["daynight"])
            if record.get("daynight") is not None
            else None
        ),
        "version": require_csv_value(record, "version")
    }

def normalize_firms_records(
    records: list[dict[str, str | None]],
    source: FIRMSProduct,
) -> list[dict[str, Any]]:
   return [
        normalize_firms_record(record, source)
        for record in records
    ]
