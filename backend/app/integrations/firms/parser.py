import csv
from io import StringIO
from typing import cast


def parse_firms_csv(csv_text: str) -> list[dict[str, str | None]]:
    if not csv_text.strip():
        raise ValueError("CSV response is empty.")

    reader = csv.DictReader(StringIO(csv_text))

    if not reader.fieldnames:
        raise ValueError("CSV headers are missing.")

    records = []

    for row in reader:
        if None in row:
            raise ValueError("CSV row contains more values than headers.")

        records.append(cast(dict[str, str | None], row))

    return records
