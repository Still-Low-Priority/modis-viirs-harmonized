from datetime import date
from math import inf, nan

import pytest
from pydantic import ValidationError

from app.integrations.firms.enums import FIRMSProduct
from app.schemas.ingestion import (
    IngestionJobAccepted,
    IngestionJobCreate,
    IngestionJobStatus,
)


@pytest.fixture
def valid_payload() -> dict[str, object]:
    return {
        "source": "VIIRS_SNPP_NRT",
        "west": 22.0,
        "south": 44.0,
        "east": 40.0,
        "north": 52.0,
        "start_date": "2026-01-01",
        "end_date": "2026-01-05",
    }


def error_locations(error: ValidationError) -> set[tuple]:
    return {tuple(item["loc"]) for item in error.errors()}


def test_valid_payload_is_parsed(valid_payload: dict[str, object]) -> None:
    job = IngestionJobCreate.model_validate(valid_payload)

    assert job.source is FIRMSProduct.VIIRS_SNPP_NRT
    assert (job.west, job.south, job.east, job.north) == (
        22.0,
        44.0,
        40.0,
        52.0,
    )
    assert job.start_date == date(2026, 1, 1)
    assert job.end_date == date(2026, 1, 5)


@pytest.mark.parametrize("source", list(FIRMSProduct))
def test_every_firms_product_is_accepted(
    valid_payload: dict[str, object],
    source: FIRMSProduct,
) -> None:
    job = IngestionJobCreate.model_validate(
        {**valid_payload, "source": source.value}
    )

    assert job.source is source


@pytest.mark.parametrize(
    "source",
    [
        "LANDSAT_NRT",
        "MODIS",
        "modis_nrt",
        "VIIRS_SNPP_NRT ",
        "",
        None,
        1,
    ],
)
def test_unknown_source_is_rejected(
    valid_payload: dict[str, object],
    source: object,
) -> None:
    with pytest.raises(ValidationError) as error:
        IngestionJobCreate.model_validate({**valid_payload, "source": source})

    assert error_locations(error.value) == {("source",)}


@pytest.mark.parametrize(
    "field",
    [
        "source",
        "west",
        "south",
        "east",
        "north",
        "start_date",
        "end_date",
    ],
)
def test_every_field_is_required(
    valid_payload: dict[str, object],
    field: str,
) -> None:
    del valid_payload[field]

    with pytest.raises(ValidationError) as error:
        IngestionJobCreate.model_validate(valid_payload)

    assert error.value.errors()[0]["type"] == "missing"
    assert error_locations(error.value) == {(field,)}


@pytest.mark.parametrize(
    "extra",
    [
        {"area_id": 1},
        {"radius_km": 10},
        {"West": 1.0},
        {"map_key": "secret"},
    ],
)
def test_extra_fields_are_forbidden(
    valid_payload: dict[str, object],
    extra: dict[str, object],
) -> None:
    with pytest.raises(ValidationError) as error:
        IngestionJobCreate.model_validate({**valid_payload, **extra})

    assert error.value.errors()[0]["type"] == "extra_forbidden"
    assert error_locations(error.value) == {tuple(extra)}


# --- coordinate ranges ----------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("west", -180.0001),
        ("west", 180.0001),
        ("west", -1000.0),
        ("east", -180.0001),
        ("east", 180.0001),
        ("east", 360.0),
        ("south", -90.0001),
        ("south", 90.0001),
        ("south", -91.0),
        ("north", -90.0001),
        ("north", 90.0001),
        ("north", 180.0),
    ],
)
def test_out_of_range_coordinates_are_rejected(
    valid_payload: dict[str, object],
    field: str,
    value: float,
) -> None:
    with pytest.raises(ValidationError) as error:
        IngestionJobCreate.model_validate({**valid_payload, field: value})

    assert error_locations(error.value) == {(field,)}


@pytest.mark.parametrize(
    ("west", "south", "east", "north"),
    [
        (-180.0, -90.0, 180.0, 90.0),
        (-180.0, 0.0, 0.0, 90.0),
        (0.0, -90.0, 180.0, 0.0),
        (-0.0001, -0.0001, 0.0001, 0.0001),
    ],
)
def test_coordinates_on_the_range_limits_are_accepted(
    valid_payload: dict[str, object],
    west: float,
    south: float,
    east: float,
    north: float,
) -> None:
    job = IngestionJobCreate.model_validate(
        {
            **valid_payload,
            "west": west,
            "south": south,
            "east": east,
            "north": north,
        }
    )

    assert (job.west, job.south, job.east, job.north) == (
        west,
        south,
        east,
        north,
    )


@pytest.mark.parametrize("field", ["west", "south", "east", "north"])
@pytest.mark.parametrize(
    "value",
    [inf, -inf, nan, "inf", "-inf", "nan", "Infinity", "NaN"],
)
def test_inf_and_nan_are_rejected(
    valid_payload: dict[str, object],
    field: str,
    value: object,
) -> None:
    with pytest.raises(ValidationError) as error:
        IngestionJobCreate.model_validate({**valid_payload, field: value})

    assert error_locations(error.value) == {(field,)}


@pytest.mark.parametrize("field", ["west", "south", "east", "north"])
@pytest.mark.parametrize("value", [None, "abc", "", [1.0], {"value": 1.0}])
def test_non_numeric_coordinates_are_rejected(
    valid_payload: dict[str, object],
    field: str,
    value: object,
) -> None:
    with pytest.raises(ValidationError) as error:
        IngestionJobCreate.model_validate({**valid_payload, field: value})

    assert error_locations(error.value) == {(field,)}


def test_numeric_strings_and_integers_are_coerced(
    valid_payload: dict[str, object],
) -> None:
    job = IngestionJobCreate.model_validate(
        {**valid_payload, "west": "22.5", "north": 52}
    )

    assert job.west == 22.5
    assert job.north == 52.0
    assert isinstance(job.north, float)


# --- cross-field rules ----------------------------------------------------


@pytest.mark.parametrize("longitude", [-180.0, 0.0, 31.5, 180.0])
def test_west_equal_to_east_is_rejected(
    valid_payload: dict[str, object],
    longitude: float,
) -> None:
    with pytest.raises(ValidationError, match="West and east must be different"):
        IngestionJobCreate.model_validate(
            {**valid_payload, "west": longitude, "east": longitude}
        )


def test_negative_zero_west_equals_positive_zero_east(
    valid_payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError, match="West and east must be different"):
        IngestionJobCreate.model_validate(
            {**valid_payload, "west": -0.0, "east": 0.0}
        )


@pytest.mark.parametrize(
    ("west", "east"),
    [
        (170.0, -170.0),
        (180.0, -180.0),
        (40.0, 22.0),
    ],
)
def test_west_greater_than_east_is_accepted_as_antimeridian_bbox(
    valid_payload: dict[str, object],
    west: float,
    east: float,
) -> None:
    job = IngestionJobCreate.model_validate(
        {**valid_payload, "west": west, "east": east}
    )

    assert (job.west, job.east) == (west, east)


@pytest.mark.parametrize(
    ("south", "north"),
    [
        (52.0, 44.0),
        (44.0, 44.0),
        (0.0, 0.0),
        (90.0, 90.0),
        (-90.0, -90.0),
        (0.0001, 0.0),
        (90.0, -90.0),
    ],
)
def test_south_not_below_north_is_rejected(
    valid_payload: dict[str, object],
    south: float,
    north: float,
) -> None:
    with pytest.raises(ValidationError, match="South must be less than north"):
        IngestionJobCreate.model_validate(
            {**valid_payload, "south": south, "north": north}
        )


@pytest.mark.parametrize(
    ("start_date", "end_date"),
    [
        ("2026-01-06", "2026-01-05"),
        ("2026-01-01", "2025-12-31"),
        ("2027-01-01", "2026-12-31"),
    ],
)
def test_start_date_after_end_date_is_rejected(
    valid_payload: dict[str, object],
    start_date: str,
    end_date: str,
) -> None:
    with pytest.raises(
        ValidationError,
        match="start_date cannot be later than end_date",
    ):
        IngestionJobCreate.model_validate(
            {
                **valid_payload,
                "start_date": start_date,
                "end_date": end_date,
            }
        )


def test_single_day_range_is_accepted(
    valid_payload: dict[str, object],
) -> None:
    job = IngestionJobCreate.model_validate(
        {
            **valid_payload,
            "start_date": "2026-01-05",
            "end_date": "2026-01-05",
        }
    )

    assert job.start_date == job.end_date == date(2026, 1, 5)


@pytest.mark.parametrize("field", ["start_date", "end_date"])
@pytest.mark.parametrize(
    "value",
    [
        "2026-02-30",
        "2026-13-01",
        "01.02.2026",
        "yesterday",
        "",
        None,
        "2026-01-01T12:30:00",
    ],
)
def test_invalid_dates_are_rejected(
    valid_payload: dict[str, object],
    field: str,
    value: object,
) -> None:
    with pytest.raises(ValidationError) as error:
        IngestionJobCreate.model_validate({**valid_payload, field: value})

    assert error_locations(error.value) == {(field,)}


def test_range_rules_are_reported_at_model_level(
    valid_payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError) as error:
        IngestionJobCreate.model_validate({**valid_payload, "east": 22.0})

    errors = error.value.errors()

    assert len(errors) == 1
    assert errors[0]["loc"] == ()
    assert errors[0]["type"] == "value_error"


def test_field_errors_are_all_reported_together(
    valid_payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError) as error:
        IngestionJobCreate.model_validate(
            {
                **valid_payload,
                "source": "nope",
                "west": -500,
                "north": 500,
                "end_date": "not-a-date",
            }
        )

    assert error_locations(error.value) == {
        ("source",),
        ("west",),
        ("north",),
        ("end_date",),
    }


def test_json_body_is_validated_the_same_way(
    valid_payload: dict[str, object],
) -> None:
    job = IngestionJobCreate.model_validate_json(
        '{"source": "MODIS_SP", "west": 170, "south": -10, "east": -170,'
        ' "north": 10, "start_date": "2026-01-01", "end_date": "2026-01-02"}'
    )

    assert job.source is FIRMSProduct.MODIS_SP
    assert job.model_dump(mode="json") == {
        "source": "MODIS_SP",
        "west": 170.0,
        "south": -10.0,
        "east": -170.0,
        "north": 10.0,
        "start_date": "2026-01-01",
        "end_date": "2026-01-02",
    }

    with pytest.raises(ValidationError):
        IngestionJobCreate.model_validate_json(
            '{"source": "MODIS_SP", "west": NaN, "south": -10, "east": -170,'
            ' "north": 10, "start_date": "2026-01-01",'
            ' "end_date": "2026-01-02"}'
        )


# --- response models ------------------------------------------------------


def test_accepted_response_defaults_to_pending() -> None:
    accepted = IngestionJobAccepted(task_id="abc")

    assert accepted.model_dump() == {"task_id": "abc", "status": "PENDING"}


@pytest.mark.parametrize("status", ["STARTED", "SUCCESS", "pending", ""])
def test_accepted_response_only_allows_pending(status: str) -> None:
    with pytest.raises(ValidationError):
        IngestionJobAccepted(task_id="abc", status=status)


def test_status_response_defaults() -> None:
    status = IngestionJobStatus(task_id="abc", status="STARTED")

    assert status.model_dump() == {
        "task_id": "abc",
        "status": "STARTED",
        "result": None,
        "error": None,
    }


def test_status_response_carries_result_and_error() -> None:
    done = IngestionJobStatus(
        task_id="abc",
        status="SUCCESS",
        result={"status": "completed", "batch_id": "42"},
    )
    failed = IngestionJobStatus(
        task_id="abc",
        status="FAILURE",
        error="FIRMS request failed",
    )

    assert done.result == {"status": "completed", "batch_id": "42"}
    assert done.error is None
    assert failed.result is None
    assert failed.error == "FIRMS request failed"
