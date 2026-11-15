from datetime import datetime, time
from typing import Any
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.filters import DetectionFilters
from app.core.enums import TimeSeriesInterval
from app.integrations.firms.enums import FIRMSProduct
from app.models.fire_detections import FireDetection
from app.repositories.detections import build_detection_conditions


def get_period_boundary(
    value,
    interval: TimeSeriesInterval,
) -> datetime:
    if interval == TimeSeriesInterval.DAY:
        return datetime.combine(value, time.min)

    if interval == TimeSeriesInterval.MONTH:
        return datetime(value.year, value.month, 1)

    return datetime(value.year, 1, 1)


def format_period(
    value: datetime,
    interval: TimeSeriesInterval,
) -> str:
    if interval == TimeSeriesInterval.DAY:
        return value.strftime("%Y-%m-%d")

    if interval == TimeSeriesInterval.MONTH:
        return value.strftime("%Y-%m")

    return value.strftime("%Y")


async def get_timeseries(
    session: AsyncSession,
    filters: DetectionFilters,
    *,
    interval: TimeSeriesInterval,
    group_by_source: bool = False,
) -> list[dict[str, Any]]:
    conditions = build_detection_conditions(filters)

    start_period = get_period_boundary(
        filters.date_from,
        interval,
    )
    end_period = get_period_boundary(
        filters.date_to,
        interval,
    )

    interval_steps = {
        TimeSeriesInterval.DAY: text("INTERVAL '1 day'"),
        TimeSeriesInterval.MONTH: text("INTERVAL '1 month'"),
        TimeSeriesInterval.YEAR: text("INTERVAL '1 year'"),
    }

    # Generate every calendar period in the requested range.
    periods = (
        func.generate_series(
            start_period,
            end_period,
            interval_steps[interval],
        )
        .table_valued("period")
        # Renders "AS periods(period)". A plain alias gives "AS periods",
        # where the only column is called "periods" and periods.period
        # does not exist.
        .render_derived(name="periods")
    )

    # Convert timestamptz to UTC before grouping.
    period_expression = func.date_trunc(
        interval.value,
        func.timezone(
            "UTC",
            FireDetection.acquired_at,
        ),
    )

    # Aggregate detections and FRP for periods with data.
    aggregates = (
        select(
            period_expression.label("period"),
            func.count(FireDetection.id).label("count"),
            func.coalesce(
                func.sum(FireDetection.frp),
                0.0,
            ).label("frp_sum"),
        )
        .where(*conditions)
        .group_by(period_expression)
        .subquery()
    )

    # LEFT JOIN preserves periods without detections.
    stmt = (
        select(
            periods.c.period,
            func.coalesce(aggregates.c.count, 0).label("count"),
            func.coalesce(
                aggregates.c.frp_sum,
                0.0,
            ).label("frp_sum"),
        )
        .select_from(
            periods.outerjoin(
                aggregates,
                periods.c.period == aggregates.c.period,
            )
        )
        .order_by(periods.c.period)
    )

    result = await session.execute(stmt)
    rows = result.all()

    # Optionally collect detection counts by product.
    source_counts = {}

    if group_by_source:
        source_stmt = (
            select(
                period_expression.label("period"),
                FireDetection.source_product,
                func.count(FireDetection.id).label("count"),
            )
            .where(*conditions)
            .group_by(
                period_expression,
                FireDetection.source_product,
            )
        )

        source_result = await session.execute(source_stmt)

        source_counts = {
            (row.period, row.source_product): row.count
            for row in source_result.all()
        }

    items = []

    for row in rows:
        item = {
            "period": format_period(row.period, interval),
            "count": row.count,
            "frp_sum": float(row.frp_sum),
        }

        if group_by_source:
            item["by_source"] = {
                source.value: source_counts.get(
                    (row.period, source.value),
                    0,
                )
                for source in filters.sources
            }

        items.append(item)

    return items
