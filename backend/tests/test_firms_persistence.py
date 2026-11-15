from datetime import datetime, timedelta, timezone

import pytest

from app.core.enums import DayNight
from app.integrations.firms.persistence import build_record_hash, prepare_detection_records


def test_record_hash_is_stable_for_equivalent_records(valid_normalized_record: dict[str, object]) -> None:
    same_values_in_other_order = dict(reversed(list(valid_normalized_record.items())))

    assert build_record_hash(valid_normalized_record) == build_record_hash(same_values_in_other_order)


def test_record_hash_changes_when_detection_data_changes(valid_normalized_record: dict[str, object]) -> None:
    assert build_record_hash(valid_normalized_record) != build_record_hash(valid_normalized_record | {"frp": 99.0})


def test_record_hash_ignores_storage_managed_fields(valid_normalized_record: dict[str, object]) -> None:
    managed = valid_normalized_record | {"record_hash": "old", "ingestion_batch_id": 42}
    assert build_record_hash(valid_normalized_record) == build_record_hash(managed)


def test_record_hash_normalizes_aware_datetimes_to_utc(valid_normalized_record: dict[str, object]) -> None:
    eastern = datetime(2026, 1, 2, 5, 4, tzinfo=timezone(timedelta(hours=2)))
    assert build_record_hash(valid_normalized_record) == build_record_hash(valid_normalized_record | {"acquired_at": eastern})


def test_prepare_records_adds_hash_and_batch_without_mutating_input(valid_normalized_record: dict[str, object]) -> None:
    prepared = prepare_detection_records([valid_normalized_record], batch_id=7)

    assert prepared == [{**valid_normalized_record, "record_hash": build_record_hash(valid_normalized_record), "ingestion_batch_id": 7}]
    assert "record_hash" not in valid_normalized_record


def test_record_hash_rejects_naive_datetime(valid_normalized_record: dict[str, object]) -> None:
    with pytest.raises(TypeError, match="Naive datetime"):
        build_record_hash(valid_normalized_record | {"acquired_at": datetime(2026, 1, 2)})
