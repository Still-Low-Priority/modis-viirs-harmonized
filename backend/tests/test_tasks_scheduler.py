import logging
import os
from datetime import date
from types import SimpleNamespace

# Dummy settings so importing the app never needs backend/.env or real services.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("FIRMS_MAP_KEY", "test-map-key")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

import pytest
from celery.schedules import crontab
from pydantic import SecretStr
from sqlalchemy.pool import NullPool

from app.celery_app import celery_app
from app.integrations.firms.enums import FIRMSProduct
from app.tasks import ingestion as ingestion_tasks
from app.tasks import scheduler as scheduler_tasks


INGESTION_TASK = "app.tasks.ingestion.run_firms_ingestion"
SCHEDULER_TASK = "app.tasks.scheduler.schedule_nrt_ingestion"

FAKE_DATABASE_URL = "postgresql+asyncpg://fake:fake@db.invalid:5432/fake"
FAKE_MAP_KEY = SecretStr("fake-map-key")

NRT_SOURCES = ["MODIS_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"]


class FakeEngine:
    def __init__(self) -> None:
        self.disposed = 0

    async def dispose(self) -> None:
        self.disposed += 1


class FakeSession:
    def __init__(self) -> None:
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        self.closed = True


class FakeInfra:
    """Stands in for the database engine, session factory and FIRMS client."""

    def __init__(self) -> None:
        self.engine = FakeEngine()
        self.engine_calls: list[tuple[tuple, dict]] = []
        self.sessions: list[FakeSession] = []
        self.client_keys: list[object] = []
        self.availability_requests = 0
        self.availability_csv = ""
        self.availability_error: Exception | None = None

    def create_async_engine(self, *args, **kwargs) -> FakeEngine:
        self.engine_calls.append((args, kwargs))
        return self.engine

    def async_sessionmaker(self, engine, **kwargs):
        assert engine is self.engine

        def factory() -> FakeSession:
            session = FakeSession()
            self.sessions.append(session)
            return session

        return factory

    def firms_client(self, firms_map_key, *args, **kwargs):
        infra = self
        infra.client_keys.append(firms_map_key)

        class FakeFIRMSClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
                return None

            async def get_data_availability_csv(self, source="ALL") -> str:
                infra.availability_requests += 1

                if infra.availability_error is not None:
                    raise infra.availability_error

                return infra.availability_csv

        return FakeFIRMSClient()

    def install(self, monkeypatch: pytest.MonkeyPatch, module) -> None:
        monkeypatch.setattr(
            module,
            "get_database_settings",
            lambda: SimpleNamespace(DATABASE_URL=SecretStr(FAKE_DATABASE_URL)),
        )
        monkeypatch.setattr(
            module,
            "get_firms_settings",
            lambda: SimpleNamespace(FIRMS_MAP_KEY=FAKE_MAP_KEY),
        )
        monkeypatch.setattr(module, "create_async_engine", self.create_async_engine)
        monkeypatch.setattr(module, "async_sessionmaker", self.async_sessionmaker)
        monkeypatch.setattr(module, "FIRMSClient", self.firms_client)


class SendTaskSpy:
    def __init__(self) -> None:
        self.calls: list[tuple[tuple, dict]] = []

    def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return SimpleNamespace(id=f"task-{len(self.calls)}")

    def jobs(self) -> list[dict]:
        return [kwargs["kwargs"] for _, kwargs in self.calls]


@pytest.fixture
def send_task(monkeypatch: pytest.MonkeyPatch) -> SendTaskSpy:
    spy = SendTaskSpy()
    monkeypatch.setattr(celery_app, "send_task", spy)
    return spy


def make_area(area_id: int, west: float, south: float, east: float, north: float):
    return SimpleNamespace(id=area_id, west=west, south=south, east=east, north=north)


def availability_csv(ranges: dict[str, tuple[str, str]]) -> str:
    rows = ["data_id,min_date,max_date"]
    rows.extend(f"{source},{start},{end}" for source, (start, end) in ranges.items())
    return "\n".join(rows) + "\n"


# --- Celery configuration -----------------------------------------------------


def test_beat_schedule_runs_the_nrt_scheduler_every_six_hours() -> None:
    entry = celery_app.conf.beat_schedule["nrt-ingestion-every-six-hours"]

    assert entry["task"] == SCHEDULER_TASK
    assert entry["schedule"] == crontab(minute=0, hour="*/6")
    assert entry["schedule"].hour == {0, 6, 12, 18}
    assert entry["schedule"].minute == {0}


def test_beat_schedule_only_references_registered_tasks() -> None:
    for entry in celery_app.conf.beat_schedule.values():
        assert entry["task"] in celery_app.tasks


def test_tasks_are_registered_under_the_names_used_by_send_task() -> None:
    assert ingestion_tasks.run_firms_ingestion_task.name == INGESTION_TASK
    assert scheduler_tasks.schedule_nrt_ingestion.name == SCHEDULER_TASK
    assert INGESTION_TASK in celery_app.tasks
    assert SCHEDULER_TASK in celery_app.tasks
    assert {"app.tasks.ingestion", "app.tasks.scheduler"} <= set(celery_app.conf.include)


def test_celery_uses_json_and_utc() -> None:
    assert celery_app.conf.task_serializer == "json"
    assert celery_app.conf.result_serializer == "json"
    assert list(celery_app.conf.accept_content) == ["json"]
    assert celery_app.conf.timezone == "UTC"
    assert celery_app.conf.enable_utc is True
    # Needed for the STARTED state reported by GET /api/ingestion/jobs/{id}.
    assert celery_app.conf.task_track_started is True


def test_httpx_request_logging_is_silenced_to_protect_the_map_key() -> None:
    httpx_logger = logging.getLogger("httpx")

    # httpx logs full request URLs at INFO; FIRMS URLs contain MAP_KEY.
    assert httpx_logger.level >= logging.WARNING
    assert not httpx_logger.isEnabledFor(logging.INFO)


# --- ingestion task -----------------------------------------------------------


def run_task(**overrides: object) -> dict[str, str]:
    kwargs: dict[str, object] = {
        "source": "VIIRS_NOAA20_NRT",
        "west": 22.0,
        "south": 44.0,
        "east": 40.5,
        "north": 52.5,
        "start_date": "2026-11-01",
        "end_date": "2026-11-05",
    }
    return ingestion_tasks.run_firms_ingestion_task(**(kwargs | overrides))


@pytest.fixture
def pipeline_stats(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Replaces the async pipeline wrapper; returns the dict the test can tune."""
    state = {
        "result": {"batches_total": 5, "batches_failed": 0},
        "calls": [],
    }

    async def fake_run_ingestion_async(*args, **kwargs):
        state["calls"].append((args, kwargs))
        return state["result"]

    monkeypatch.setattr(ingestion_tasks, "_run_ingestion_async", fake_run_ingestion_async)
    return state


def test_ingestion_task_returns_the_documented_result(pipeline_stats: dict) -> None:
    assert run_task() == {
        "source": "VIIRS_NOAA20_NRT",
        "start_date": "2026-11-01",
        "end_date": "2026-11-05",
        "message": "Pipeline execution finished.",
    }


def test_ingestion_task_succeeds_when_there_was_nothing_to_ingest(pipeline_stats: dict) -> None:
    pipeline_stats["result"] = {"batches_total": 0, "batches_failed": 0}

    assert run_task()["message"] == "Pipeline execution finished."


def test_ingestion_task_passes_parsed_arguments_to_the_pipeline(pipeline_stats: dict) -> None:
    run_task(area_id=3)

    assert pipeline_stats["calls"] == [
        (
            (FIRMSProduct.VIIRS_NOAA20_NRT,),
            {
                "west": 22.0,
                "south": 44.0,
                "east": 40.5,
                "north": 52.5,
                "start_date": date(2026, 11, 1),
                "end_date": date(2026, 11, 5),
                "area_id": 3,
            },
        )
    ]


def test_ingestion_task_defaults_to_no_area(pipeline_stats: dict) -> None:
    run_task()

    assert pipeline_stats["calls"][0][1]["area_id"] is None


@pytest.mark.parametrize("failed,total", [(1, 5), (5, 5)])
def test_ingestion_task_raises_when_batches_failed(
    pipeline_stats: dict,
    failed: int,
    total: int,
) -> None:
    pipeline_stats["result"] = {"batches_total": total, "batches_failed": failed}

    with pytest.raises(RuntimeError, match=f"{failed} of {total} ingestion batches failed"):
        run_task()


@pytest.mark.parametrize("overrides", [
    {"source": "LANDSAT_NRT"},
    {"start_date": "01.11.2026"},
    {"end_date": "not-a-date"},
])
def test_ingestion_task_rejects_bad_arguments_before_running_the_pipeline(
    pipeline_stats: dict,
    overrides: dict[str, str],
) -> None:
    with pytest.raises(ValueError):
        run_task(**overrides)

    assert pipeline_stats["calls"] == []


def test_ingestion_task_propagates_pipeline_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def failing_run_ingestion_async(*args, **kwargs):
        raise ConnectionError("database is down")

    monkeypatch.setattr(ingestion_tasks, "_run_ingestion_async", failing_run_ingestion_async)

    with pytest.raises(ConnectionError, match="database is down"):
        run_task()


async def test_run_ingestion_async_wires_session_client_and_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    infra = FakeInfra()
    infra.install(monkeypatch, ingestion_tasks)
    calls: list[tuple[tuple, dict]] = []

    async def fake_run_ingestion(*args, **kwargs):
        calls.append((args, kwargs))
        return {"batches_total": 2, "batches_failed": 0}

    monkeypatch.setattr(ingestion_tasks, "run_ingestion", fake_run_ingestion)

    stats = await ingestion_tasks._run_ingestion_async(
        FIRMSProduct.MODIS_NRT,
        west=22.0,
        south=44.0,
        east=40.5,
        north=52.5,
        start_date=date(2026, 11, 1),
        end_date=date(2026, 11, 5),
        area_id=9,
    )

    assert stats == {"batches_total": 2, "batches_failed": 0}
    # A worker process must not keep pooled connections between event loops.
    assert infra.engine_calls == [((FAKE_DATABASE_URL,), {"poolclass": NullPool})]
    assert infra.client_keys == [FAKE_MAP_KEY]

    (args, kwargs), = calls
    session, _client, source = args
    assert session is infra.sessions[0]
    assert source is FIRMSProduct.MODIS_NRT
    assert kwargs == {
        "west": 22.0,
        "south": 44.0,
        "east": 40.5,
        "north": 52.5,
        "start_date": date(2026, 11, 1),
        "end_date": date(2026, 11, 5),
        "area_id": 9,
    }
    assert session.closed is True
    assert infra.engine.disposed == 1


async def test_run_ingestion_async_disposes_the_engine_when_the_pipeline_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    infra = FakeInfra()
    infra.install(monkeypatch, ingestion_tasks)

    async def failing_run_ingestion(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(ingestion_tasks, "run_ingestion", failing_run_ingestion)

    with pytest.raises(RuntimeError, match="boom"):
        await ingestion_tasks._run_ingestion_async(
            FIRMSProduct.MODIS_NRT,
            west=22.0,
            south=44.0,
            east=40.5,
            north=52.5,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 5),
        )

    assert infra.engine.disposed == 1


# --- NRT scheduler ------------------------------------------------------------


@pytest.fixture
def scheduler(monkeypatch: pytest.MonkeyPatch) -> FakeInfra:
    infra = FakeInfra()
    infra.install(monkeypatch, scheduler_tasks)
    infra.areas = []
    infra.area_sessions = []

    async def fake_get_all_areas(session):
        infra.area_sessions.append(session)
        return infra.areas

    monkeypatch.setattr(scheduler_tasks, "get_all_areas", fake_get_all_areas)
    return infra


def test_scheduler_targets_exactly_the_nrt_products() -> None:
    assert [product.value for product in scheduler_tasks.NRT_PRODUCTS] == NRT_SOURCES
    assert set(scheduler_tasks.NRT_PRODUCTS) == {
        product for product in FIRMSProduct if product.value.endswith("_NRT")
    }


def test_scheduler_dispatches_nothing_when_no_areas_are_configured(
    scheduler: FakeInfra,
    send_task: SendTaskSpy,
) -> None:
    result = scheduler_tasks.schedule_nrt_ingestion()

    assert result == {"areas": 0, "products": 0, "tasks_dispatched": 0}
    assert send_task.calls == []
    # No reason to spend a FIRMS request when there is nothing to ingest.
    assert scheduler.client_keys == []
    assert scheduler.availability_requests == 0
    assert scheduler.engine.disposed == 1


def test_scheduler_dispatches_one_job_per_area_per_nrt_product(
    scheduler: FakeInfra,
    send_task: SendTaskSpy,
) -> None:
    scheduler.areas = [
        make_area(1, 22.0, 44.0, 40.5, 52.5),
        make_area(2, 170.0, -10.0, -170.0, 10.0),
    ]
    scheduler.availability_csv = availability_csv(
        {source: ("2026-01-01", "2026-11-14") for source in NRT_SOURCES}
        # SP products are available too but must never be scheduled.
        | {"MODIS_SP": ("2000-11-01", "2026-07-31"), "VIIRS_SNPP_SP": ("2012-01-20", "2026-06-30")}
    )

    result = scheduler_tasks.schedule_nrt_ingestion()

    assert result == {"areas": 2, "products": 4, "tasks_dispatched": 8}
    assert [args for args, _ in send_task.calls] == [(INGESTION_TASK,)] * 8
    assert all(set(kwargs) == {"kwargs"} for _, kwargs in send_task.calls)

    jobs = send_task.jobs()
    assert sorted((job["source"], job["area_id"]) for job in jobs) == sorted(
        (source, area_id) for source in NRT_SOURCES for area_id in (1, 2)
    )

    for job in jobs:
        expected_box = (
            (22.0, 44.0, 40.5, 52.5) if job["area_id"] == 1 else (170.0, -10.0, -170.0, 10.0)
        )
        assert (job["west"], job["south"], job["east"], job["north"]) == expected_box
        # The last five available days, inclusive.
        assert job["start_date"] == "2026-11-10"
        assert job["end_date"] == "2026-11-14"

    assert scheduler.client_keys == [FAKE_MAP_KEY]
    assert scheduler.availability_requests == 1
    assert scheduler.area_sessions == scheduler.sessions
    assert scheduler.sessions[0].closed is True
    assert scheduler.engine.disposed == 1


def test_scheduler_jobs_are_accepted_by_the_ingestion_task(
    scheduler: FakeInfra,
    send_task: SendTaskSpy,
    pipeline_stats: dict,
) -> None:
    scheduler.areas = [make_area(1, 22.0, 44.0, 40.5, 52.5)]
    scheduler.availability_csv = availability_csv({"MODIS_NRT": ("2026-01-01", "2026-11-14")})

    scheduler_tasks.schedule_nrt_ingestion()
    (job,) = send_task.jobs()
    result = ingestion_tasks.run_firms_ingestion_task(**job)

    assert result["source"] == "MODIS_NRT"
    assert pipeline_stats["calls"][0][1] == {
        "west": 22.0,
        "south": 44.0,
        "east": 40.5,
        "north": 52.5,
        "start_date": date(2026, 11, 10),
        "end_date": date(2026, 11, 14),
        "area_id": 1,
    }


def test_scheduler_uses_each_products_own_availability_range(
    scheduler: FakeInfra,
    send_task: SendTaskSpy,
) -> None:
    scheduler.areas = [make_area(1, 22.0, 44.0, 40.5, 52.5)]
    scheduler.availability_csv = availability_csv({
        "MODIS_NRT": ("2026-01-01", "2026-11-14"),
        "VIIRS_NOAA20_NRT": ("2026-01-01", "2026-11-13"),
        # Window crosses a month boundary.
        "VIIRS_NOAA21_NRT": ("2026-01-01", "2026-11-02"),
        # Fewer than five days are available: do not ask for earlier dates.
        "VIIRS_SNPP_NRT": ("2026-11-12", "2026-11-14"),
    })

    scheduler_tasks.schedule_nrt_ingestion()

    assert {
        job["source"]: (job["start_date"], job["end_date"]) for job in send_task.jobs()
    } == {
        "MODIS_NRT": ("2026-11-10", "2026-11-14"),
        "VIIRS_NOAA20_NRT": ("2026-11-09", "2026-11-13"),
        "VIIRS_NOAA21_NRT": ("2026-10-29", "2026-11-02"),
        "VIIRS_SNPP_NRT": ("2026-11-12", "2026-11-14"),
    }


def test_scheduler_handles_a_single_available_day(
    scheduler: FakeInfra,
    send_task: SendTaskSpy,
) -> None:
    scheduler.areas = [make_area(1, 22.0, 44.0, 40.5, 52.5)]
    scheduler.availability_csv = availability_csv({"MODIS_NRT": ("2026-11-14", "2026-11-14")})

    scheduler_tasks.schedule_nrt_ingestion()

    (job,) = send_task.jobs()
    assert (job["start_date"], job["end_date"]) == ("2026-11-14", "2026-11-14")


def test_scheduler_skips_products_without_availability_information(
    scheduler: FakeInfra,
    send_task: SendTaskSpy,
) -> None:
    scheduler.areas = [
        make_area(1, 22.0, 44.0, 40.5, 52.5),
        make_area(2, -10.0, 35.0, 5.0, 44.0),
        make_area(3, 100.0, -5.0, 120.0, 5.0),
    ]
    scheduler.availability_csv = availability_csv({
        "MODIS_NRT": ("2026-01-01", "2026-11-14"),
        "VIIRS_SNPP_NRT": ("2026-01-01", "2026-11-14"),
        "MODIS_SP": ("2000-11-01", "2026-07-31"),
    })

    result = scheduler_tasks.schedule_nrt_ingestion()

    assert result == {"areas": 3, "products": 2, "tasks_dispatched": 6}
    assert {job["source"] for job in send_task.jobs()} == {"MODIS_NRT", "VIIRS_SNPP_NRT"}


def test_scheduler_dispatches_nothing_when_firms_reports_no_nrt_products(
    scheduler: FakeInfra,
    send_task: SendTaskSpy,
) -> None:
    scheduler.areas = [make_area(1, 22.0, 44.0, 40.5, 52.5)]
    scheduler.availability_csv = availability_csv({"MODIS_SP": ("2000-11-01", "2026-07-31")})

    result = scheduler_tasks.schedule_nrt_ingestion()

    assert result == {"areas": 1, "products": 0, "tasks_dispatched": 0}
    assert send_task.calls == []


def test_scheduler_dispatches_nothing_and_cleans_up_when_firms_is_unavailable(
    scheduler: FakeInfra,
    send_task: SendTaskSpy,
) -> None:
    scheduler.areas = [make_area(1, 22.0, 44.0, 40.5, 52.5)]
    scheduler.availability_error = ConnectionError("FIRMS is down")

    with pytest.raises(ConnectionError, match="FIRMS is down"):
        scheduler_tasks.schedule_nrt_ingestion()

    assert send_task.calls == []
    assert scheduler.engine.disposed == 1


def test_scheduler_does_not_log_the_map_key(
    scheduler: FakeInfra,
    send_task: SendTaskSpy,
    caplog: pytest.LogCaptureFixture,
) -> None:
    scheduler.areas = [make_area(1, 22.0, 44.0, 40.5, 52.5)]
    scheduler.availability_csv = availability_csv({"MODIS_NRT": ("2026-01-01", "2026-11-14")})

    with caplog.at_level(logging.DEBUG):
        scheduler_tasks.schedule_nrt_ingestion()

    assert "dispatched 1 jobs for 1 areas and 1 products" in caplog.text
    assert FAKE_MAP_KEY.get_secret_value() not in caplog.text
    assert FAKE_DATABASE_URL not in caplog.text
