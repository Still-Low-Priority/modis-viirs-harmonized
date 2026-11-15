import hashlib
import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any

def json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise TypeError("Naive datetime is not supported.")

        return value.astimezone(timezone.utc).isoformat()

    if isinstance(value, Enum):
        return value.value

    raise TypeError(f"Unsupported type: {type(value).__name__}")

def build_record_hash(record):
    payload = {
        key: value
        for key, value in record.items()
        if key not in {"record_hash", "ingestion_batch_id"}
    }
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=json_default, allow_nan=False)
    encoded = serialized.encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()

def prepare_detection_records(records, batch_id):
    prepared_records = []
    for record in records:
        prepared_record = record.copy()
        prepared_record["record_hash"] = build_record_hash(record)
        prepared_record["ingestion_batch_id"] = batch_id
        prepared_records.append(prepared_record)
    return prepared_records
