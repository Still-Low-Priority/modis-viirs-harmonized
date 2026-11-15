import pytest

from app.integrations.firms.parser import parse_firms_csv


def test_parses_csv_records_and_empty_values() -> None:
    records = parse_firms_csv("latitude,longitude,confidence\n49.0,31.0,\n")

    assert records == [{"latitude": "49.0", "longitude": "31.0", "confidence": ""}]


@pytest.mark.parametrize("csv_text", ["", " \n\t "])
def test_rejects_empty_csv_response(csv_text: str) -> None:
    with pytest.raises(ValueError, match="CSV response is empty"):
        parse_firms_csv(csv_text)


def test_rejects_row_with_more_values_than_headers() -> None:
    with pytest.raises(ValueError, match="more values than headers"):
        parse_firms_csv("latitude,longitude\n49.0,31.0,unexpected\n")


def test_returns_no_records_for_header_only_csv() -> None:
    assert parse_firms_csv("latitude,longitude\n") == []
