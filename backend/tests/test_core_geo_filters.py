from dataclasses import FrozenInstanceError
from datetime import date, datetime, timedelta, timezone
from typing import get_args

import pytest
from sqlalchemy import column
from sqlalchemy.dialects import postgresql

from app.core.enums import ConfidenceLevel, DayNight, ProcessingMode
from app.core.filters import BoundingBox, DetectionFilters
from app.core.geo import lon_filter
from app.core.types import ConfidenceLabel
from app.integrations.firms.enums import FIRMSProduct


def compile_sql(expression) -> str:
    return str(
        expression.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )


def lon_matches(west: float, east: float, longitude: float) -> bool:
    # Evaluates the generated SQL in Python: the expression only uses
    # BETWEEN / AND / OR / comparisons, which read the same in both.
    sql = compile_sql(lon_filter(column("longitude"), west, east))

    if " BETWEEN " in sql:
        _, bounds = sql.split(" BETWEEN ")
        low, high = (float(value) for value in bounds.split(" AND "))
        return low <= longitude <= high

    return bool(eval(sql.lower(), {"longitude": longitude}))


def make_filters(**overrides) -> DetectionFilters:
    values = {
        "date_from": date(2026, 11, 12),
        "date_to": date(2026, 11, 13),
        "processing": ProcessingMode.NRT,
        "sources": (FIRMSProduct.VIIRS_NOAA20_NRT,),
    }
    values.update(overrides)

    return DetectionFilters(**values)


# --- lon_filter -----------------------------------------------------------


@pytest.mark.parametrize(
    ("west", "east", "expected"),
    [
        (22.0, 40.0, "longitude BETWEEN 22.0 AND 40.0"),
        (-180.0, 180.0, "longitude BETWEEN -180.0 AND 180.0"),
        (-10.5, -3.25, "longitude BETWEEN -10.5 AND -3.25"),
        (31.0, 31.0, "longitude BETWEEN 31.0 AND 31.0"),
    ],
)
def test_lon_filter_uses_between_for_a_regular_bbox(
    west: float,
    east: float,
    expected: str,
) -> None:
    assert compile_sql(lon_filter(column("longitude"), west, east)) == expected


@pytest.mark.parametrize(
    ("west", "east", "expected"),
    [
        (170.0, -170.0, "longitude >= 170.0 OR longitude <= -170.0"),
        (0.5, -0.5, "longitude >= 0.5 OR longitude <= -0.5"),
        (180.0, -180.0, "longitude >= 180.0 OR longitude <= -180.0"),
    ],
)
def test_lon_filter_splits_a_bbox_that_crosses_the_antimeridian(
    west: float,
    east: float,
    expected: str,
) -> None:
    assert compile_sql(lon_filter(column("longitude"), west, east)) == expected


@pytest.mark.parametrize(
    ("west", "east", "longitude", "expected"),
    [
        # Regular bbox, both bounds inclusive.
        (22.0, 40.0, 22.0, True),
        (22.0, 40.0, 31.0, True),
        (22.0, 40.0, 40.0, True),
        (22.0, 40.0, 21.9999, False),
        (22.0, 40.0, 40.0001, False),
        (22.0, 40.0, -31.0, False),
        # Crossing the 180th meridian, both bounds inclusive.
        (170.0, -170.0, 170.0, True),
        (170.0, -170.0, 175.0, True),
        (170.0, -170.0, 180.0, True),
        (170.0, -170.0, -180.0, True),
        (170.0, -170.0, -175.0, True),
        (170.0, -170.0, -170.0, True),
        (170.0, -170.0, 169.9999, False),
        (170.0, -170.0, -169.9999, False),
        (170.0, -170.0, 0.0, False),
    ],
)
def test_lon_filter_selects_the_expected_longitudes(
    west: float,
    east: float,
    longitude: float,
    expected: bool,
) -> None:
    assert lon_matches(west, east, longitude) is expected


def test_lon_filter_uses_bound_parameters() -> None:
    compiled = lon_filter(column("longitude"), 170.0, -170.0).compile(
        dialect=postgresql.dialect()
    )

    assert sorted(compiled.params.values()) == [-170.0, 170.0]
    assert "170" not in str(compiled)


# --- DetectionFilters / BoundingBox ---------------------------------------


def test_bounding_box_keeps_west_south_east_north_order() -> None:
    bbox = BoundingBox(22.0, 44.0, 40.0, 52.0)

    assert (bbox.west, bbox.south, bbox.east, bbox.north) == (
        22.0,
        44.0,
        40.0,
        52.0,
    )
    assert bbox == BoundingBox(west=22.0, south=44.0, east=40.0, north=52.0)


def test_bounding_box_is_immutable() -> None:
    bbox = BoundingBox(22.0, 44.0, 40.0, 52.0)

    with pytest.raises(FrozenInstanceError):
        bbox.west = 0.0  # type: ignore[misc]


def test_detection_filters_optional_fields_default_to_none() -> None:
    filters = make_filters()

    assert filters.bbox is None
    assert filters.daynight is None
    assert filters.min_confidence is None


def test_detection_filters_start_at_is_utc_midnight() -> None:
    filters = make_filters()

    assert filters.start_at == datetime(2026, 11, 12, tzinfo=timezone.utc)
    assert filters.start_at.utcoffset() == timedelta(0)


def test_detection_filters_end_at_is_the_last_microsecond_of_the_day() -> None:
    filters = make_filters()

    assert filters.end_at == datetime(
        2026,
        11,
        13,
        23,
        59,
        59,
        999_999,
        tzinfo=timezone.utc,
    )
    assert filters.end_at.utcoffset() == timedelta(0)
    assert filters.end_at + timedelta(microseconds=1) == datetime(
        2026,
        11,
        14,
        tzinfo=timezone.utc,
    )


@pytest.mark.parametrize(
    ("day", "expected_seconds"),
    [
        (date(2026, 11, 13), 86_400),
        (date(2024, 2, 29), 86_400),
        (date(2025, 12, 31), 86_400),
    ],
)
def test_single_day_filter_covers_the_whole_day(
    day: date,
    expected_seconds: int,
) -> None:
    filters = make_filters(date_from=day, date_to=day)
    covered = filters.end_at - filters.start_at + timedelta(microseconds=1)

    assert filters.start_at.date() == day
    assert filters.end_at.date() == day
    assert covered.total_seconds() == expected_seconds


def test_detection_filters_is_immutable_and_hashable() -> None:
    filters = make_filters(
        bbox=BoundingBox(22.0, 44.0, 40.0, 52.0),
        daynight=DayNight.NIGHT,
        min_confidence=ConfidenceLevel.HIGH,
    )

    with pytest.raises(FrozenInstanceError):
        filters.date_from = date(2020, 1, 1)  # type: ignore[misc]

    assert filters == make_filters(
        bbox=BoundingBox(22.0, 44.0, 40.0, 52.0),
        daynight=DayNight.NIGHT,
        min_confidence=ConfidenceLevel.HIGH,
    )
    assert len({filters, make_filters()}) == 2


# --- ConfidenceLabel ------------------------------------------------------


def test_confidence_label_matches_confidence_levels() -> None:
    literal, none_type = get_args(ConfidenceLabel)

    assert none_type is type(None)
    assert set(get_args(literal)) == {
        level.value
        for level in ConfidenceLevel
    }
