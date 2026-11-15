from datetime import date
from unittest.mock import AsyncMock

import pytest

from app.integrations.firms.availability import FIRMSDateRange
from app.integrations.firms.enums import FIRMSProduct
from app.integrations.firms import planner


def test_find_missing_ranges_returns_whole_range_when_uncovered() -> None:
    assert planner.find_missing_ranges(date(2026, 1, 1), date(2026, 1, 10), []) == [(date(2026, 1, 1), date(2026, 1, 10))]


def test_find_missing_ranges_returns_nothing_when_fully_covered() -> None:
    assert planner.find_missing_ranges(date(2026, 1, 1), date(2026, 1, 10), [(date(2025, 12, 1), date(2026, 2, 1))]) == []


def test_find_missing_ranges_handles_overlap_and_multiple_gaps() -> None:
    result = planner.find_missing_ranges(
        date(2026, 1, 1),
        date(2026, 1, 15),
        [(date(2026, 1, 8), date(2026, 1, 10)), (date(2026, 1, 3), date(2026, 1, 5)), (date(2026, 1, 5), date(2026, 1, 6))],
    )
    assert result == [(date(2026, 1, 1), date(2026, 1, 2)), (date(2026, 1, 7), date(2026, 1, 7)), (date(2026, 1, 11), date(2026, 1, 15))]


@pytest.mark.parametrize("max_days,expected", [(5, [(date(2026, 1, 1), date(2026, 1, 5)), (date(2026, 1, 6), date(2026, 1, 10)), (date(2026, 1, 11), date(2026, 1, 12))]), (20, [(date(2026, 1, 1), date(2026, 1, 12))])])
def test_split_date_range_obeys_maximum_days(max_days: int, expected: list[tuple[date, date]]) -> None:
    assert planner.split_date_range(date(2026, 1, 1), date(2026, 1, 12), max_days) == expected


@pytest.mark.parametrize("start,end,max_days,error", [(date(2026, 1, 2), date(2026, 1, 1), 5, "start_date cannot exceed"), (date(2026, 1, 1), date(2026, 1, 1), 0, "max_days must be greater")])
def test_split_date_range_rejects_invalid_arguments(start: date, end: date, max_days: int, error: str) -> None:
    with pytest.raises(ValueError, match=error):
        planner.split_date_range(start, end, max_days)


async def test_plan_ingestion_refreshes_recent_nrt_completed_data(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(planner, "get_existing_batch_ranges", AsyncMock(return_value=[(date(2026, 1, 1), date(2026, 1, 10))]))
    monkeypatch.setattr(planner, "get_active_batch_ranges", AsyncMock(return_value=[]))

    plan = await planner.plan_ingestion(
        object(), {FIRMSProduct.MODIS_NRT: FIRMSDateRange(date(2026, 1, 1), date(2026, 1, 10))}, FIRMSProduct.MODIS_NRT,
        west=20, south=40, east=30, north=50, nrt_refresh_days=3,
    )

    assert plan == [(date(2026, 1, 8), date(2026, 1, 10))]


async def test_plan_ingestion_excludes_active_nrt_ranges_from_refresh(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(planner, "get_existing_batch_ranges", AsyncMock(return_value=[(date(2026, 1, 1), date(2026, 1, 7))]))
    monkeypatch.setattr(planner, "get_active_batch_ranges", AsyncMock(return_value=[(date(2026, 1, 9), date(2026, 1, 9))]))

    plan = await planner.plan_ingestion(
        object(), {FIRMSProduct.VIIRS_SNPP_NRT: FIRMSDateRange(date(2026, 1, 1), date(2026, 1, 10))}, FIRMSProduct.VIIRS_SNPP_NRT,
        west=20, south=40, east=30, north=50, nrt_refresh_days=3,
    )

    assert plan == [(date(2026, 1, 8), date(2026, 1, 8)), (date(2026, 1, 10), date(2026, 1, 10))]


async def test_plan_ingestion_uses_historical_rules_when_refresh_anchor_is_outside_availability(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(planner, "get_existing_batch_ranges", AsyncMock(return_value=[(date(2026, 1, 1), date(2026, 1, 5))]))
    monkeypatch.setattr(planner, "get_active_batch_ranges", AsyncMock())

    plan = await planner.plan_ingestion(
        object(), {FIRMSProduct.MODIS_NRT: FIRMSDateRange(date(2026, 1, 1), date(2026, 1, 10))}, FIRMSProduct.MODIS_NRT,
        west=20, south=40, east=30, north=50, nrt_refresh_end=date(2026, 1, 11), max_days=3,
    )

    assert plan == [(date(2026, 1, 6), date(2026, 1, 8)), (date(2026, 1, 9), date(2026, 1, 10))]
