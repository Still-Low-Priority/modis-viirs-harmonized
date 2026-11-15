"""Confidence harmonization (MODIS 0-100 and VIIRS l/n/h -> low/nominal/high).

No PostgreSQL test database is available to the test suite, so the expressions
are checked in two ways:

* compiled with the PostgreSQL dialect and asserted on the generated SQL;
* compiled with the SQLite dialect and evaluated by the in-memory SQLite that
  ships with Python, to check the CASE logic row by row. Only inputs whose
  semantics are the same in both databases are evaluated this way (a
  non-numeric MODIS value is not: SQLite casts it to 0, PostgreSQL raises).
"""

import os
import re
import sqlite3
from datetime import date

# Dummy settings so importing the app never needs backend/.env or real services.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("FIRMS_MAP_KEY", "test-map-key")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

import pytest
from sqlalchemy.dialects import postgresql, sqlite

from app.core.enums import ConfidenceLevel, ProcessingMode
from app.core.filters import DetectionFilters
from app.integrations.firms.enums import FIRMSProduct
from app.repositories.detections import (
    build_detection_conditions,
    confidence_label_expression,
    confidence_rank_expression,
)


MODIS_CASES = [
    ("0", 1, "low"),
    ("1", 1, "low"),
    ("15", 1, "low"),
    ("29", 1, "low"),
    ("30", 2, "nominal"),
    ("50", 2, "nominal"),
    ("79", 2, "nominal"),
    ("80", 3, "high"),
    ("95", 3, "high"),
    ("100", 3, "high"),
]

VIIRS_CASES = [
    ("l", 1, "low"),
    ("n", 2, "nominal"),
    ("h", 3, "high"),
    # FIRMS archives are not consistent about the letter case.
    ("L", 1, "low"),
    ("N", 2, "nominal"),
    ("H", 3, "high"),
]

UNKNOWN_CASES = [
    ("MODIS", "101"),
    ("MODIS", "-1"),
    ("MODIS", "1000"),
    ("VIIRS", "x"),
    ("VIIRS", "low"),
    ("VIIRS", "high"),
    ("VIIRS", ""),
    # A numeric value is only meaningful for MODIS and letters only for VIIRS.
    ("VIIRS", "80"),
    ("VIIRS", "0"),
    # Unknown instruments are never guessed.
    ("OLI", "80"),
    ("OLI", "h"),
    ("modis", "80"),
    ("viirs", "h"),
    ("", "h"),
]


def postgres_sql(expression) -> str:
    compiled = expression.compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    )
    return re.sub(r"\s+", " ", str(compiled))


def evaluate(expression, instrument: str, confidence_raw: str):
    """Evaluates an expression for one fire_detections row using SQLite."""
    sql = str(
        expression.compile(
            dialect=sqlite.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )
    connection = sqlite3.connect(":memory:")

    try:
        return connection.execute(
            f"SELECT {sql} FROM "
            "(SELECT ? AS instrument, ? AS confidence_raw) AS fire_detections",
            (instrument, confidence_raw),
        ).fetchone()[0]
    finally:
        connection.close()


def make_filters(min_confidence: ConfidenceLevel | None) -> DetectionFilters:
    return DetectionFilters(
        date_from=date(2026, 11, 1),
        date_to=date(2026, 11, 5),
        processing=ProcessingMode.NRT,
        sources=(FIRMSProduct.MODIS_NRT, FIRMSProduct.VIIRS_NOAA20_NRT),
        min_confidence=min_confidence,
    )


# --- evaluated semantics ------------------------------------------------------


@pytest.mark.parametrize("confidence_raw,rank,label", MODIS_CASES)
def test_modis_numeric_confidence_is_harmonized(
    confidence_raw: str,
    rank: int,
    label: str,
) -> None:
    assert evaluate(confidence_rank_expression(), "MODIS", confidence_raw) == rank
    assert evaluate(confidence_label_expression(), "MODIS", confidence_raw) == label


@pytest.mark.parametrize("confidence_raw,rank,label", VIIRS_CASES)
def test_viirs_letter_confidence_is_harmonized(
    confidence_raw: str,
    rank: int,
    label: str,
) -> None:
    assert evaluate(confidence_rank_expression(), "VIIRS", confidence_raw) == rank
    assert evaluate(confidence_label_expression(), "VIIRS", confidence_raw) == label


@pytest.mark.parametrize("instrument,confidence_raw", UNKNOWN_CASES)
def test_unknown_confidence_is_null(instrument: str, confidence_raw: str) -> None:
    assert evaluate(confidence_rank_expression(), instrument, confidence_raw) is None
    assert evaluate(confidence_label_expression(), instrument, confidence_raw) is None


def test_every_modis_value_from_0_to_100_gets_exactly_the_documented_label() -> None:
    labels = {
        value: evaluate(confidence_label_expression(), "MODIS", str(value))
        for value in range(0, 101)
    }

    assert labels == {
        value: "low" if value <= 29 else "nominal" if value <= 79 else "high"
        for value in range(0, 101)
    }


@pytest.mark.parametrize("min_confidence,kept", [
    (ConfidenceLevel.LOW, {"0", "29", "30", "79", "80", "100", "l", "n", "h"}),
    (ConfidenceLevel.NOMINAL, {"30", "79", "80", "100", "n", "h"}),
    (ConfidenceLevel.HIGH, {"80", "100", "h"}),
])
def test_min_confidence_keeps_rows_at_or_above_the_requested_level(
    min_confidence: ConfidenceLevel,
    kept: set[str],
) -> None:
    condition = build_detection_conditions(make_filters(min_confidence))[-1]
    rows = [("MODIS", value) for value in ("0", "29", "30", "79", "80", "100")]
    rows += [("VIIRS", value) for value in ("l", "n", "h")]

    matching = {
        confidence_raw
        for instrument, confidence_raw in rows
        if evaluate(condition, instrument, confidence_raw)
    }

    assert matching == kept


@pytest.mark.parametrize("min_confidence", list(ConfidenceLevel))
@pytest.mark.parametrize("instrument,confidence_raw", [
    ("MODIS", "101"),
    ("VIIRS", "x"),
    ("OLI", "h"),
])
def test_min_confidence_never_matches_rows_with_unknown_confidence(
    min_confidence: ConfidenceLevel,
    instrument: str,
    confidence_raw: str,
) -> None:
    condition = build_detection_conditions(make_filters(min_confidence))[-1]

    # NULL >= n is NULL, which a WHERE clause treats as "no match".
    assert not evaluate(condition, instrument, confidence_raw)


# --- PostgreSQL SQL structure -------------------------------------------------


def test_rank_expression_compiles_to_the_documented_postgresql_case() -> None:
    assert postgres_sql(confidence_rank_expression()) == (
        "CASE "
        "WHEN (fire_detections.instrument = 'MODIS') THEN "
        "CASE "
        "WHEN (CAST(fire_detections.confidence_raw AS INTEGER) BETWEEN 80 AND 100) THEN 3 "
        "WHEN (CAST(fire_detections.confidence_raw AS INTEGER) BETWEEN 30 AND 79) THEN 2 "
        "WHEN (CAST(fire_detections.confidence_raw AS INTEGER) BETWEEN 0 AND 29) THEN 1 "
        "END "
        "WHEN (fire_detections.instrument = 'VIIRS') THEN "
        "CASE "
        "WHEN (lower(fire_detections.confidence_raw) = 'h') THEN 3 "
        "WHEN (lower(fire_detections.confidence_raw) = 'n') THEN 2 "
        "WHEN (lower(fire_detections.confidence_raw) = 'l') THEN 1 "
        "END "
        "END"
    )


def test_rank_expression_has_no_else_branch_so_unknown_values_are_null() -> None:
    assert "ELSE" not in postgres_sql(confidence_rank_expression())
    assert "ELSE" not in postgres_sql(confidence_label_expression())


def test_modis_integer_cast_is_guarded_by_the_instrument_check() -> None:
    sql = postgres_sql(confidence_rank_expression())

    # PostgreSQL raises on CAST('n' AS INTEGER), so the numeric branch must only
    # be reachable for MODIS rows: the instrument test has to come first.
    assert sql.index("fire_detections.instrument = 'MODIS'") < sql.index("CAST(")
    viirs_branch = sql[sql.index("fire_detections.instrument = 'VIIRS'"):]
    assert "CAST(" not in viirs_branch


def test_label_expression_maps_ranks_to_labels() -> None:
    rank_sql = postgres_sql(confidence_rank_expression())
    label_sql = postgres_sql(confidence_label_expression())

    assert label_sql == (
        "CASE "
        f"WHEN ({rank_sql} = 3) THEN 'high' "
        f"WHEN ({rank_sql} = 2) THEN 'nominal' "
        f"WHEN ({rank_sql} = 1) THEN 'low' "
        "END"
    )


@pytest.mark.parametrize("min_confidence,minimum_rank", [
    (ConfidenceLevel.LOW, 1),
    (ConfidenceLevel.NOMINAL, 2),
    (ConfidenceLevel.HIGH, 3),
])
def test_min_confidence_adds_a_rank_threshold_condition(
    min_confidence: ConfidenceLevel,
    minimum_rank: int,
) -> None:
    without_filter = build_detection_conditions(make_filters(None))
    with_filter = build_detection_conditions(make_filters(min_confidence))

    assert len(with_filter) == len(without_filter) + 1
    assert postgres_sql(with_filter[-1]) == (
        f"{postgres_sql(confidence_rank_expression())} >= {minimum_rank}"
    )


def test_no_confidence_condition_without_min_confidence() -> None:
    conditions = build_detection_conditions(make_filters(None))

    assert all("confidence_raw" not in postgres_sql(condition) for condition in conditions)
