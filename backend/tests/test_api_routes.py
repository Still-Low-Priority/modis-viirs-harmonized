import os
from datetime import date, datetime, timezone
from types import SimpleNamespace

# Dummy settings so importing the app never needs backend/.env or real services.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("FIRMS_MAP_KEY", "test-map-key")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.dependencies.detection_filters import parse_bbox
from app.api.routes import detections as detections_routes
from app.api.routes import hotspots as hotspots_routes
from app.api.routes import meta as meta_routes
from app.api.routes import timeseries as timeseries_routes
from app.core.database import get_db
from app.core.enums import ConfidenceLevel, DayNight, ProcessingMode, TimeSeriesInterval
from app.core.filters import BoundingBox, DetectionFilters
from app.integrations.firms.enums import FIRMSProduct
from app.main import app
from app.services.hotspots import HotspotDetection


PERIOD = {"date_from": "2026-11-01", "date_to": "2026-11-05"}

# Every endpoint that builds DetectionFilters, with its other required params.
FILTERED_ENDPOINTS = [
    ("/api/detections", {}),
    ("/api/detections/grid", {"cell": "0.5"}),
    ("/api/stats/timeseries", {}),
    ("/api/hotspots", {}),
]

SP_PRODUCTS = (
    FIRMSProduct.MODIS_SP,
    FIRMSProduct.VIIRS_NOAA20_SP,
    FIRMSProduct.VIIRS_NOAA21_SP,
    FIRMSProduct.VIIRS_SNPP_SP,
)

NRT_PRODUCTS = (
    FIRMSProduct.MODIS_NRT,
    FIRMSProduct.VIIRS_NOAA20_NRT,
    FIRMSProduct.VIIRS_NOAA21_NRT,
    FIRMSProduct.VIIRS_SNPP_NRT,
)


class Calls:
    """Records how the routes call the (mocked) repository layer."""

    def __init__(self) -> None:
        self.session = object()
        self.calls: list[tuple[str, tuple, dict]] = []
        self.detections_page: tuple[int, list] = (0, [])
        self.detection_by_id: tuple | None = None
        self.grid: list[dict] = []
        self.timeseries: list[dict] = []
        self.hotspot_detections: list[HotspotDetection] = []
        self.source_metadata: dict = {"sources": [], "date_min": None, "date_max": None}
        self.last_ingested_at: datetime | None = None

    def record(self, name: str, args: tuple, kwargs: dict) -> None:
        self.calls.append((name, args, kwargs))

    def names(self) -> list[str]:
        return [name for name, _, _ in self.calls]

    def only(self, name: str) -> tuple[tuple, dict]:
        matches = [(args, kwargs) for called, args, kwargs in self.calls if called == name]
        assert len(matches) == 1
        return matches[0]

    def filters(self, name: str) -> DetectionFilters:
        args, _ = self.only(name)
        return args[1]


@pytest.fixture
def repo(monkeypatch: pytest.MonkeyPatch) -> Calls:
    calls = Calls()

    async def fake_get_db():
        yield calls.session

    def fake(name: str, attribute: str):
        async def repository_function(*args, **kwargs):
            calls.record(name, args, kwargs)
            return getattr(calls, attribute)

        return repository_function

    monkeypatch.setattr(
        detections_routes, "get_detections_page", fake("get_detections_page", "detections_page"),
    )
    monkeypatch.setattr(
        detections_routes, "get_detection_by_id", fake("get_detection_by_id", "detection_by_id"),
    )
    monkeypatch.setattr(
        detections_routes, "get_detection_grid", fake("get_detection_grid", "grid"),
    )
    monkeypatch.setattr(
        timeseries_routes, "get_timeseries", fake("get_timeseries", "timeseries"),
    )
    monkeypatch.setattr(
        hotspots_routes, "get_hotspot_detections",
        fake("get_hotspot_detections", "hotspot_detections"),
    )
    monkeypatch.setattr(
        meta_routes, "get_source_metadata", fake("get_source_metadata", "source_metadata"),
    )
    monkeypatch.setattr(
        meta_routes, "get_last_ingested_at", fake("get_last_ingested_at", "last_ingested_at"),
    )

    app.dependency_overrides[get_db] = fake_get_db
    yield calls
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def client(repo: Calls) -> TestClient:
    return TestClient(app)


def make_detection(**overrides: object) -> SimpleNamespace:
    values = {
        "id": 7,
        "latitude": 49.5,
        "longitude": 31.25,
        "acquired_at": datetime(2026, 11, 3, 10, 30, tzinfo=timezone.utc),
        "source_product": "VIIRS_NOAA20_NRT",
        "satellite": "N20",
        "instrument": "VIIRS",
        "confidence_raw": "n",
        "detection_type": None,
        "frp": 2.5,
        "brightness": None,
        "bright_t31": None,
        "bright_ti4": 330.1,
        "bright_ti5": 290.4,
        "scan": 0.4,
        "track": 0.4,
        "daynight": DayNight.DAY,
        "version": "2.0NRT",
    }
    return SimpleNamespace(**(values | overrides))


# --- service endpoints -------------------------------------------------------


def test_root_responds_ok(client: TestClient) -> None:
    response = client.get("/api")

    assert response.status_code == 200
    assert response.json() == {"service": "modis-viirs-harmonized", "status": "ok"}


def test_health_responds_ok(client: TestClient, repo: Calls) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    # Health must not depend on the database.
    assert repo.calls == []


def test_openapi_schema_lists_all_public_routes(client: TestClient) -> None:
    response = client.get("/api/openapi.json")

    assert response.status_code == 200
    assert {
        "/api",
        "/api/health",
        "/api/meta",
        "/api/detections",
        "/api/detections/grid",
        "/api/detections/{detection_id}",
        "/api/stats/timeseries",
        "/api/hotspots",
        "/api/ingestion/jobs",
        "/api/ingestion/jobs/{task_id}",
    } <= set(response.json()["paths"])


# --- shared detection filters: validation -----------------------------------


@pytest.mark.parametrize("path,extra", FILTERED_ENDPOINTS)
@pytest.mark.parametrize("params", [
    {},
    {"date_from": "2026-11-01"},
    {"date_to": "2026-11-05"},
    {"date_from": "01.11.2026", "date_to": "2026-11-05"},
    {"date_from": "2026-11-01", "date_to": "2026-02-30"},
    {"date_from": "2026-11-01", "date_to": "tomorrow"},
    {"date_from": "2026-11-06", "date_to": "2026-11-05"},
])
def test_filtered_endpoints_reject_missing_or_invalid_period(
    client: TestClient,
    repo: Calls,
    path: str,
    extra: dict[str, str],
    params: dict[str, str],
) -> None:
    response = client.get(path, params=extra | params)

    assert response.status_code == 422
    assert repo.calls == []


def test_start_after_end_is_explained(client: TestClient) -> None:
    response = client.get(
        "/api/detections",
        params={"date_from": "2026-11-06", "date_to": "2026-11-05"},
    )

    assert response.json() == {"detail": "date_from cannot be later than date_to."}


@pytest.mark.parametrize("path,extra", FILTERED_ENDPOINTS)
@pytest.mark.parametrize("bbox", [
    "",
    "20,40,30",
    "20,40,30,50,60",
    "a,40,30,50",
    "20,,30,50",
    "nan,40,30,50",
    "20,40,inf,50",
    "-181,40,30,50",
    "20,40,180.5,50",
    "20,-91,30,50",
    "20,40,30,91",
    "20,50,30,40",
    "20,50,30,50",
    "30,40,30,50",
])
def test_filtered_endpoints_reject_invalid_bbox(
    client: TestClient,
    repo: Calls,
    path: str,
    extra: dict[str, str],
    bbox: str,
) -> None:
    response = client.get(path, params=PERIOD | extra | {"bbox": bbox})

    assert response.status_code == 422
    assert repo.calls == []


@pytest.mark.parametrize("value,detail", [
    ("20,40,30", "bbox must contain west,south,east,north."),
    ("20,x,30,50", "bbox coordinates must be numeric."),
    ("20,40,30,nan", "bbox coordinates must be finite."),
    ("20,50,30,40", "Invalid bbox coordinates."),
])
def test_parse_bbox_reports_the_reason(value: str, detail: str) -> None:
    with pytest.raises(HTTPException) as error:
        parse_bbox(value)

    assert error.value.status_code == 422
    assert error.value.detail == detail


def test_parse_bbox_accepts_missing_spaced_and_antimeridian_boxes() -> None:
    assert parse_bbox(None) is None
    assert parse_bbox(" 20, 40 ,30.5,50 ") == BoundingBox(20.0, 40.0, 30.5, 50.0)
    assert parse_bbox("170,-10,-170,10") == BoundingBox(170.0, -10.0, -170.0, 10.0)
    assert parse_bbox("-180,-90,180,90") == BoundingBox(-180.0, -90.0, 180.0, 90.0)


@pytest.mark.parametrize("path,extra", FILTERED_ENDPOINTS)
@pytest.mark.parametrize("params", [
    {"source": "LANDSAT_NRT"},
    {"source": "modis_sp"},
    {"source": ""},
    {"processing": "URT"},
    {"processing": "nrt"},
    {"daynight": "X"},
    {"daynight": "day"},
    {"min_confidence": "medium"},
    {"min_confidence": "h"},
    {"min_confidence": "80"},
])
def test_filtered_endpoints_reject_unknown_enum_values(
    client: TestClient,
    repo: Calls,
    path: str,
    extra: dict[str, str],
    params: dict[str, str],
) -> None:
    response = client.get(path, params=PERIOD | extra | params)

    assert response.status_code == 422
    assert repo.calls == []


@pytest.mark.parametrize("path,extra", FILTERED_ENDPOINTS)
@pytest.mark.parametrize("params,incompatible", [
    # SP is the default processing mode.
    ({"source": "MODIS_NRT"}, ["MODIS_NRT"]),
    ({"processing": "SP", "source": ["MODIS_SP", "VIIRS_SNPP_NRT"]}, ["VIIRS_SNPP_NRT"]),
    ({"processing": "NRT", "source": "MODIS_SP"}, ["MODIS_SP"]),
    (
        {"processing": "NRT", "source": ["VIIRS_NOAA20_SP", "MODIS_NRT", "VIIRS_NOAA21_SP"]},
        ["VIIRS_NOAA20_SP", "VIIRS_NOAA21_SP"],
    ),
])
def test_filtered_endpoints_reject_sources_of_the_other_processing_mode(
    client: TestClient,
    repo: Calls,
    path: str,
    extra: dict[str, str],
    params: dict[str, object],
    incompatible: list[str],
) -> None:
    response = client.get(path, params=PERIOD | extra | params)

    assert response.status_code == 422
    assert response.json() == {
        "detail": {
            "message": "Source products must match the selected processing mode.",
            "incompatible_sources": incompatible,
        },
    }
    assert repo.calls == []


# --- shared detection filters: wiring ---------------------------------------


def test_filters_default_to_all_standard_processing_products(
    client: TestClient,
    repo: Calls,
) -> None:
    response = client.get("/api/detections", params=PERIOD)

    assert response.status_code == 200
    args, kwargs = repo.only("get_detections_page")
    assert args[0] is repo.session
    assert args[1] == DetectionFilters(
        date_from=date(2026, 11, 1),
        date_to=date(2026, 11, 5),
        processing=ProcessingMode.SP,
        sources=SP_PRODUCTS,
        bbox=None,
        daynight=None,
        min_confidence=None,
    )
    assert kwargs == {"limit": 5000}


def test_filters_select_all_nrt_products_for_nrt_processing(
    client: TestClient,
    repo: Calls,
) -> None:
    client.get("/api/detections", params=PERIOD | {"processing": "NRT"})

    filters = repo.filters("get_detections_page")
    assert filters.processing is ProcessingMode.NRT
    assert filters.sources == NRT_PRODUCTS


@pytest.mark.parametrize("path,extra,repository_function", [
    ("/api/detections", {}, "get_detections_page"),
    ("/api/detections/grid", {"cell": "0.5"}, "get_detection_grid"),
    ("/api/stats/timeseries", {}, "get_timeseries"),
    ("/api/hotspots", {}, "get_hotspot_detections"),
])
def test_every_filtered_endpoint_passes_the_parsed_filters_to_its_repository(
    client: TestClient,
    repo: Calls,
    path: str,
    extra: dict[str, str],
    repository_function: str,
) -> None:
    response = client.get(path, params=PERIOD | extra | {
        "processing": "NRT",
        "source": ["VIIRS_SNPP_NRT", "MODIS_NRT", "VIIRS_SNPP_NRT"],
        "bbox": "22,44,40.5,52.5",
        "daynight": "N",
        "min_confidence": "nominal",
    })

    assert response.status_code == 200
    assert repo.names() == [repository_function]
    args, _ = repo.only(repository_function)
    assert args[0] is repo.session
    assert args[1] == DetectionFilters(
        date_from=date(2026, 11, 1),
        date_to=date(2026, 11, 5),
        processing=ProcessingMode.NRT,
        # Requested order is kept, duplicates are dropped.
        sources=(FIRMSProduct.VIIRS_SNPP_NRT, FIRMSProduct.MODIS_NRT),
        bbox=BoundingBox(west=22.0, south=44.0, east=40.5, north=52.5),
        daynight=DayNight.NIGHT,
        min_confidence=ConfidenceLevel.NOMINAL,
    )


def test_single_day_period_is_accepted(client: TestClient, repo: Calls) -> None:
    response = client.get(
        "/api/detections",
        params={"date_from": "2026-11-05", "date_to": "2026-11-05"},
    )

    assert response.status_code == 200
    filters = repo.filters("get_detections_page")
    assert filters.start_at == datetime(2026, 11, 5, tzinfo=timezone.utc)
    assert filters.end_at == datetime(2026, 11, 5, 23, 59, 59, 999999, tzinfo=timezone.utc)


# --- /api/detections ----------------------------------------------------------


@pytest.mark.parametrize("limit", ["0", "-1", "20001", "many", "1.5"])
def test_detections_reject_invalid_limit(client: TestClient, repo: Calls, limit: str) -> None:
    response = client.get("/api/detections", params=PERIOD | {"limit": limit})

    assert response.status_code == 422
    assert repo.calls == []


def test_detections_return_a_geojson_feature_collection(
    client: TestClient,
    repo: Calls,
) -> None:
    repo.detections_page = (
        3,
        [
            (make_detection(), "nominal"),
            (make_detection(id=8, daynight=DayNight.NIGHT), None),
        ],
    )

    response = client.get("/api/detections", params=PERIOD | {"processing": "NRT", "limit": "2"})

    assert response.status_code == 200
    assert repo.only("get_detections_page")[1] == {"limit": 2}
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert body["total"] == 3
    assert body["truncated"] is True
    assert body["features"][0] == {
        "type": "Feature",
        "id": 7,
        # GeoJSON order: longitude first.
        "geometry": {"type": "Point", "coordinates": [31.25, 49.5]},
        "properties": {
            "acquired_at": "2026-11-03T10:30:00Z",
            "source_product": "VIIRS_NOAA20_NRT",
            "instrument": "VIIRS",
            "confidence": "nominal",
            "frp": 2.5,
            "daynight": "D",
        },
    }
    assert body["features"][1]["properties"]["confidence"] is None
    assert body["features"][1]["properties"]["daynight"] == "N"


def test_detections_are_not_truncated_when_everything_fits(
    client: TestClient,
    repo: Calls,
) -> None:
    repo.detections_page = (1, [(make_detection(), "high")])

    body = client.get("/api/detections", params=PERIOD).json()

    assert body["total"] == 1
    assert body["truncated"] is False


# --- /api/detections/grid -----------------------------------------------------


@pytest.mark.parametrize("extra", [
    {},
    {"cell": "0"},
    {"cell": "-0.5"},
    {"cell": "180.1"},
    {"cell": "nan"},
    {"cell": "inf"},
    {"cell": "wide"},
])
def test_grid_rejects_missing_or_invalid_cell(
    client: TestClient,
    repo: Calls,
    extra: dict[str, str],
) -> None:
    response = client.get("/api/detections/grid", params=PERIOD | extra)

    assert response.status_code == 422
    assert repo.calls == []


def test_grid_returns_cells_from_the_repository(client: TestClient, repo: Calls) -> None:
    repo.grid = [{"lat": 49.25, "lon": 31.75, "count": 4, "frp_sum": 12.5}]

    response = client.get("/api/detections/grid", params=PERIOD | {"cell": "0.5"})

    assert response.status_code == 200
    assert response.json() == [{"lat": 49.25, "lon": 31.75, "count": 4, "frp_sum": 12.5}]
    assert repo.only("get_detection_grid")[1] == {"cell": 0.5}


# --- /api/detections/{detection_id} -------------------------------------------


@pytest.mark.parametrize("detection_id", ["0", "-5", "abc", "1.5"])
def test_detection_detail_rejects_invalid_id(
    client: TestClient,
    repo: Calls,
    detection_id: str,
) -> None:
    response = client.get(f"/api/detections/{detection_id}")

    assert response.status_code == 422
    assert repo.calls == []


def test_detection_detail_returns_404_for_unknown_id(client: TestClient, repo: Calls) -> None:
    response = client.get("/api/detections/123")

    assert response.status_code == 404
    assert response.json() == {"detail": "Detection not found"}
    assert repo.only("get_detection_by_id")[0] == (repo.session, 123)


def test_detection_detail_returns_the_harmonized_record(client: TestClient, repo: Calls) -> None:
    repo.detection_by_id = (make_detection(), "nominal")

    response = client.get("/api/detections/7")

    assert response.status_code == 200
    assert response.json() == {
        "id": 7,
        "latitude": 49.5,
        "longitude": 31.25,
        "acquired_at": "2026-11-03T10:30:00Z",
        "source_product": "VIIRS_NOAA20_NRT",
        "satellite": "N20",
        "instrument": "VIIRS",
        "confidence": "nominal",
        "confidence_raw": "n",
        "detection_type": None,
        "frp": 2.5,
        "brightness": None,
        "bright_t31": None,
        "bright_ti4": 330.1,
        "bright_ti5": 290.4,
        "scan": 0.4,
        "track": 0.4,
        "daynight": "D",
        "version": "2.0NRT",
    }


# --- /api/stats/timeseries ----------------------------------------------------


@pytest.mark.parametrize("params", [
    {"interval": "week"},
    {"interval": "hour"},
    {"interval": "DAY"},
    {"interval": ""},
    {"group_by": "instrument"},
    {"group_by": "Source"},
])
def test_timeseries_rejects_invalid_interval_or_grouping(
    client: TestClient,
    repo: Calls,
    params: dict[str, str],
) -> None:
    response = client.get("/api/stats/timeseries", params=PERIOD | params)

    assert response.status_code == 422
    assert repo.calls == []


def test_timeseries_defaults_to_daily_ungrouped_counts(client: TestClient, repo: Calls) -> None:
    repo.timeseries = [{"period": "2026-11-01", "count": 3, "frp_sum": 7.5}]

    response = client.get("/api/stats/timeseries", params=PERIOD)

    assert response.status_code == 200
    assert repo.only("get_timeseries")[1] == {
        "interval": TimeSeriesInterval.DAY,
        "group_by_source": False,
    }
    # by_source is omitted, not null, when grouping was not requested.
    assert response.json() == {
        "interval": "day",
        "items": [{"period": "2026-11-01", "count": 3, "frp_sum": 7.5}],
    }


@pytest.mark.parametrize("interval", list(TimeSeriesInterval))
def test_timeseries_passes_interval_and_grouping_to_the_repository(
    client: TestClient,
    repo: Calls,
    interval: TimeSeriesInterval,
) -> None:
    repo.timeseries = [
        {"period": "2026", "count": 3, "frp_sum": 7.5, "by_source": {"MODIS_SP": 3}},
    ]

    response = client.get(
        "/api/stats/timeseries",
        params=PERIOD | {"interval": interval.value, "group_by": "source"},
    )

    assert response.status_code == 200
    assert repo.only("get_timeseries")[1] == {"interval": interval, "group_by_source": True}
    body = response.json()
    assert body["interval"] == interval.value
    assert body["items"][0]["by_source"] == {"MODIS_SP": 3}


# --- /api/hotspots ------------------------------------------------------------


@pytest.mark.parametrize("params", [
    {"radius_km": "0"},
    {"radius_km": "-1"},
    {"radius_km": "nan"},
    {"radius_km": "far"},
    {"min_count": "0"},
    {"min_count": "-3"},
    {"min_count": "2.5"},
    {"limit": "-1"},
    {"limit": "all"},
])
def test_hotspots_reject_invalid_clustering_params(
    client: TestClient,
    repo: Calls,
    params: dict[str, str],
) -> None:
    response = client.get("/api/hotspots", params=PERIOD | params)

    assert response.status_code == 422
    assert repo.calls == []


def test_hotspots_reject_infinite_radius(repo: Calls) -> None:
    client = TestClient(app, raise_server_exceptions=False)

    response = client.get("/api/hotspots", params=PERIOD | {"radius_km": "inf"})

    assert response.status_code == 422


def test_hotspots_respond_with_defaults_when_nothing_was_detected(
    client: TestClient,
    repo: Calls,
) -> None:
    response = client.get("/api/hotspots", params=PERIOD)

    assert response.status_code == 200
    assert response.json() == {
        "radius_km": 10.0,
        "min_count": 10,
        "total": 0,
        "approximate": False,
        "items": [],
    }


def test_hotspots_cluster_the_detections_returned_by_the_repository(
    client: TestClient,
    repo: Calls,
) -> None:
    repo.hotspot_detections = [
        HotspotDetection(
            id=index + 1,
            latitude=49.0 + index * 0.001,
            longitude=31.0,
            acquired_at=datetime(2026, 11, 2, 10, index, tzinfo=timezone.utc),
            source_product="VIIRS_NOAA20_SP",
            frp=2.0,
        )
        for index in range(3)
    ]

    response = client.get(
        "/api/hotspots",
        params=PERIOD | {"radius_km": "5", "min_count": "3", "limit": "1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["radius_km"] == 5.0
    assert body["min_count"] == 3
    assert body["total"] == 1
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["count"] == 3
    assert item["frp_sum"] == pytest.approx(6.0)
    assert item["by_source"] == {"VIIRS_NOAA20_SP": 3}
    assert item["first_seen"] == "2026-11-02T10:00:00Z"
    assert item["last_seen"] == "2026-11-02T10:02:00Z"


def test_hotspots_min_count_filters_out_small_clusters(client: TestClient, repo: Calls) -> None:
    repo.hotspot_detections = [
        HotspotDetection(
            id=1,
            latitude=49.0,
            longitude=31.0,
            acquired_at=datetime(2026, 11, 2, 10, 0, tzinfo=timezone.utc),
            source_product="MODIS_SP",
            frp=2.0,
        )
    ]

    body = client.get("/api/hotspots", params=PERIOD | {"min_count": "2"}).json()

    assert body["total"] == 0
    assert body["items"] == []


# --- /api/meta ----------------------------------------------------------------


def test_meta_responds_with_nulls_for_an_empty_database(client: TestClient, repo: Calls) -> None:
    response = client.get("/api/meta")

    assert response.status_code == 200
    assert response.json() == {
        "sources": [],
        "date_min": None,
        "date_max": None,
        "last_ingested_at": None,
    }
    assert repo.calls == [
        ("get_source_metadata", (repo.session,), {}),
        ("get_last_ingested_at", (repo.session,), {}),
    ]


def test_meta_combines_source_metadata_with_the_last_ingestion_time(
    client: TestClient,
    repo: Calls,
) -> None:
    repo.source_metadata = {
        "sources": [
            {
                "source_product": "VIIRS_NOAA20_NRT",
                "processing": "NRT",
                "instrument": "VIIRS",
                "satellites": ["N20"],
                "date_min": date(2026, 11, 1),
                "date_max": date(2026, 11, 5),
            },
        ],
        "date_min": date(2026, 11, 1),
        "date_max": date(2026, 11, 5),
    }
    repo.last_ingested_at = datetime(2026, 11, 5, 6, 0, tzinfo=timezone.utc)

    response = client.get("/api/meta")

    assert response.status_code == 200
    body = response.json()
    assert body["sources"] == [
        {
            "source_product": "VIIRS_NOAA20_NRT",
            "processing": "NRT",
            "instrument": "VIIRS",
            "satellites": ["N20"],
            "date_min": "2026-11-01",
            "date_max": "2026-11-05",
        },
    ]
    assert (body["date_min"], body["date_max"]) == ("2026-11-01", "2026-11-05")
    assert datetime.fromisoformat(body["last_ingested_at"]) == repo.last_ingested_at
