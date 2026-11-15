import pytest

from app.integrations.firms.enums import FIRMSProduct
from app.integrations.firms.pipeline import build_bbox_parts, normalize_and_validate_records


def test_build_bbox_parts_returns_single_non_crossing_box() -> None:
    assert build_bbox_parts(west=20, south=40, east=30, north=50) == [(20, 40, 30, 50)]


def test_build_bbox_parts_splits_antimeridian_crossing_box() -> None:
    assert build_bbox_parts(west=170, south=-10, east=-170, north=10) == [
        (170, -10, 180, 10),
        (-180, -10, -170, 10),
    ]


@pytest.mark.parametrize("kwargs,error", [
    ({"west": 20, "south": 40, "east": 20, "north": 50}, "non-zero longitude"),
    ({"west": 20, "south": 50, "east": 30, "north": 40}, "Invalid latitude range"),
    ({"west": 181, "south": 40, "east": 30, "north": 50}, "Longitude must be between"),
])
def test_build_bbox_parts_rejects_invalid_bounds(kwargs: dict[str, float], error: str) -> None:
    with pytest.raises(ValueError, match=error):
        build_bbox_parts(**kwargs)


def test_build_bbox_parts_rejects_non_numeric_coordinates() -> None:
    with pytest.raises(TypeError, match="must be numeric"):
        build_bbox_parts(west=True, south=40, east=30, north=50)


def test_normalize_and_validate_records_keeps_valid_records_and_counts_rejections(
    valid_csv_record: dict[str, str | None],
) -> None:
    invalid_after_normalization = valid_csv_record | {"instrument": "VIIRS"}
    invalid_during_normalization = valid_csv_record | {"latitude": ""}

    valid, rejected_count = normalize_and_validate_records(
        [valid_csv_record, invalid_after_normalization, invalid_during_normalization],
        FIRMSProduct.MODIS_NRT,
    )

    assert len(valid) == 1
    assert valid[0]["latitude"] == 49.0
    assert rejected_count == 2


def test_normalize_and_validate_records_handles_an_empty_input() -> None:
    assert normalize_and_validate_records([], FIRMSProduct.MODIS_NRT) == ([], 0)
