from datetime import date, datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.firms.availability import FIRMSDateRange
from app.integrations.firms.enums import FIRMSProduct
from app.repositories.ingestion_batches import get_existing_batch_ranges, get_active_batch_ranges

def split_date_range(
    start_date: date,
    end_date: date,
    max_days: int = 5,
) -> list[tuple[date, date]]:
    if max_days < 1:
        raise ValueError("max_days must be greater than zero.")
    if start_date > end_date:
        raise ValueError("start_date cannot exceed end_date.")
    periods = []
    current_date = start_date
    while current_date <= end_date:
        days = min(max_days, (end_date - current_date).days + 1)
        period_end = current_date + timedelta(days=days - 1)
        periods.append((current_date, period_end))
        current_date += timedelta(days=days)
    return periods

def find_missing_ranges(
    available_start: date,
    available_end: date,
    existing_ranges: list[tuple[date, date]],
) -> list[tuple[date, date]]:

    if available_start > available_end:
        raise ValueError("available_start cannot exceed available_end.")

    normalized_ranges = []

    for range_start, range_end in existing_ranges:
        if range_start > range_end:
            raise ValueError("Invalid existing date range.")
 
        range_start = max(range_start, available_start)
        range_end = min(range_end, available_end)

        if range_start <= range_end:
            normalized_ranges.append((range_start, range_end))

    normalized_ranges.sort()

    missing_ranges = []
    current_date = available_start

    for range_start, range_end in normalized_ranges:
        if range_end < current_date:
            continue

        if range_start > current_date:
            missing_ranges.append((
                current_date,
                range_start - timedelta(days=1),
            ))

        current_date = max(
            current_date,
            range_end + timedelta(days=1),
        )

        if current_date > available_end:
            break

    if current_date <= available_end:
        missing_ranges.append((current_date, available_end))

    return missing_ranges

async def plan_ingestion(
    session: AsyncSession,
    availability: dict[FIRMSProduct, FIRMSDateRange],
    source: FIRMSProduct,
    *,
    west: float,
    south: float,
    east: float,
    north: float,
    max_days: int = 5,
    nrt_refresh_days: int = 5,
    nrt_refresh_end: date | None = None,
) -> list[tuple[date, date]]:
    if isinstance(max_days, bool) or not isinstance(max_days, int):
        raise TypeError("max_days must be an integer.")

    if max_days < 1:
        raise ValueError("max_days must be at least 1.")

    if isinstance(nrt_refresh_days, bool) or not isinstance(nrt_refresh_days, int):
        raise TypeError("nrt_refresh_days must be an integer.")

    if nrt_refresh_days < 1:
        raise ValueError("nrt_refresh_days must be at least 1.")

    if nrt_refresh_end is not None:
        if (
            isinstance(nrt_refresh_end, datetime)
            or not isinstance(nrt_refresh_end, date)
        ):
            raise TypeError("nrt_refresh_end must be a date.")

    date_range = availability.get(source)

    if date_range is None:
        raise ValueError(
            f"No availability information for {source.value}."
        )

    existing_ranges = await get_existing_batch_ranges(
        session,
        source,
        west=west,
        south=south,
        east=east,
        north=north,
    )

    missing_ranges = []

    # Standard Processing: only download uncovered periods.
    if not source.value.endswith("_NRT"):
        missing_ranges = find_missing_ranges(
            date_range.min_date,
            date_range.max_date,
            existing_ranges,
        )

    else:
        # Near Real-Time: refresh the latest available dates.
        active_ranges = await get_active_batch_ranges(
            session,
            source,
            west=west,
            south=south,
            east=east,
            north=north,
        )

        # Use the actual FIRMS availability endpoint as the
        # refresh anchor, not an arbitrary historical request end.
        refresh_end = (
            nrt_refresh_end
            if nrt_refresh_end is not None
            else date_range.max_date
        )

        refresh_is_requested = (
            date_range.min_date <= refresh_end <= date_range.max_date
        )

        if not refresh_is_requested:
            # The requested range does not include the latest
            # available NRT date. Treat it as historical data.
            missing_ranges = find_missing_ranges(
                date_range.min_date,
                date_range.max_date,
                existing_ranges,
            )

        else:
            refresh_start = max(
                date_range.min_date,
                refresh_end - timedelta(days=nrt_refresh_days - 1),
            )

            historical_end = refresh_start - timedelta(days=1)

            # Historical part: COMPLETED, PENDING and RUNNING
            # all count as covered.
            if date_range.min_date <= historical_end:
                missing_ranges.extend(
                    find_missing_ranges(
                        date_range.min_date,
                        historical_end,
                        existing_ranges,
                    )
                )

            # Recent part: only PENDING and RUNNING block refresh.
            # Previously COMPLETED NRT data will be downloaded again.
            missing_ranges.extend(
                find_missing_ranges(
                    refresh_start,
                    refresh_end,
                    active_ranges,
                )
            )

    # Split all missing periods into FIRMS API-sized requests.
    planned_ranges = []

    for start_date, end_date in missing_ranges:
        planned_ranges.extend(
            split_date_range(
                start_date,
                end_date,
                max_days,
            )
        )

    return planned_ranges

