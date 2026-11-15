from datetime import date

import pytest

from app.integrations.firms.availability import FIRMSDateRange, parse_data_availability
from app.integrations.firms.enums import FIRMSProduct


def test_parses_all_supported_products_and_ignores_unknown_products() -> None:
    rows = ["data_id,min_date,max_date"]
    rows.extend(f"{product.value},2026-01-01,2026-01-10" for product in FIRMSProduct)
    rows.append("UNKNOWN,2026-01-01,2026-01-10")

    availability = parse_data_availability("\n".join(rows))

    assert availability == {
        product: FIRMSDateRange(date(2026, 1, 1), date(2026, 1, 10))
        for product in FIRMSProduct
    }


def test_returns_empty_mapping_when_no_supported_products_are_present() -> None:
    assert parse_data_availability("data_id,min_date,max_date\nUNKNOWN,2026-01-01,2026-01-10\n") == {}


@pytest.mark.parametrize("csv_text,error", [
    ("data_id,min_date,max_date\n,2026-01-01,2026-01-10\n", "Missing data_id"),
    ("data_id,min_date,max_date\nMODIS_NRT,,2026-01-10\n", "Missing date range"),
    ("data_id,min_date,max_date\nMODIS_NRT,not-a-date,2026-01-10\n", "Invalid date range"),
    ("data_id,min_date,max_date\nMODIS_NRT,2026-01-11,2026-01-10\n", "min_date cannot exceed"),
])
def test_rejects_invalid_availability_rows(csv_text: str, error: str) -> None:
    with pytest.raises(ValueError, match=error):
        parse_data_availability(csv_text)


def test_rejects_duplicate_supported_product() -> None:
    csv_text = (
        "data_id,min_date,max_date\n"
        "MODIS_NRT,2026-01-01,2026-01-10\n"
        "MODIS_NRT,2026-01-11,2026-01-20\n"
    )
    with pytest.raises(ValueError, match="Duplicate availability entry"):
        parse_data_availability(csv_text)
