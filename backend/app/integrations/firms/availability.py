from dataclasses import dataclass
from datetime import date

from app.integrations.firms.enums import FIRMSProduct
from app.integrations.firms.parser import parse_firms_csv


@dataclass(frozen=True, slots=True)
class FIRMSDateRange:
    min_date: date
    max_date: date


def parse_data_availability(
    csv_text: str,
) -> dict[FIRMSProduct, FIRMSDateRange]:

    records = parse_firms_csv(csv_text)
    availability = {}

    for record in records:
        raw_source = record.get("data_id")

        if raw_source is None or not raw_source.strip():
            raise ValueError("Missing data_id in availability CSV.")

        try:
            source = FIRMSProduct(raw_source.strip())
        except ValueError:
            continue

        min_date_raw = record.get("min_date")
        max_date_raw = record.get("max_date")

        if not min_date_raw or not max_date_raw:
            raise ValueError(
                f"Missing date range for {source.value}."
            )

        try:
            min_date = date.fromisoformat(min_date_raw.strip())
            max_date = date.fromisoformat(max_date_raw.strip())
        except ValueError:
            raise ValueError(
                f"Invalid date range for {source.value}."
            ) from None

        if min_date > max_date:
            raise ValueError(
                f"min_date cannot exceed max_date for {source.value}."
            )

        if source in availability:
            raise ValueError(
                f"Duplicate availability entry for {source.value}."
            )

        availability[source] = FIRMSDateRange(
            min_date=min_date,
            max_date=max_date,
        )

    return availability
