import os
from types import SimpleNamespace
from uuid import uuid4

# Dummy settings so importing the app never needs backend/.env or real services.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("FIRMS_MAP_KEY", "test-map-key")
os.environ.setdefault("CELERY_BROKER_URL", "memory://")
os.environ.setdefault("CELERY_RESULT_BACKEND", "cache+memory://")

import pytest
from fastapi.testclient import TestClient
from kombu.exceptions import OperationalError

from app.celery_app import celery_app
from app.main import app


TASK_NAME = "app.tasks.ingestion.run_firms_ingestion"


class SendTaskSpy:
    def __init__(self, task_id: str = "5f0c1d6e-6f0a-4f0b-9a55-0d6f5f1f6f11") -> None:
        self.task_id = task_id
        self.calls: list[tuple[tuple, dict]] = []

    def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return SimpleNamespace(id=self.task_id)


class AsyncResultSpy:
    def __init__(self, state: str, result: object = None) -> None:
        self.state = state
        self.result = result
        self.requested_ids: list[str] = []

    def __call__(self, task_id: str):
        self.requested_ids.append(task_id)
        return SimpleNamespace(state=self.state, result=self.result)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def send_task(monkeypatch: pytest.MonkeyPatch) -> SendTaskSpy:
    spy = SendTaskSpy()
    monkeypatch.setattr(celery_app, "send_task", spy)
    return spy


@pytest.fixture
def valid_payload() -> dict[str, object]:
    return {
        "source": "VIIRS_NOAA20_NRT",
        "west": 22.0,
        "south": 44.0,
        "east": 40.5,
        "north": 52.5,
        "start_date": "2026-11-01",
        "end_date": "2026-11-05",
    }


def test_create_job_returns_202_with_task_id(
    client: TestClient,
    send_task: SendTaskSpy,
    valid_payload: dict[str, object],
) -> None:
    response = client.post("/api/ingestion/jobs", json=valid_payload)

    assert response.status_code == 202
    assert response.json() == {"task_id": send_task.task_id, "status": "PENDING"}


def test_create_job_sends_the_ingestion_task_with_payload_kwargs(
    client: TestClient,
    send_task: SendTaskSpy,
    valid_payload: dict[str, object],
) -> None:
    client.post("/api/ingestion/jobs", json=valid_payload)

    assert send_task.calls == [
        (
            (TASK_NAME,),
            {
                "kwargs": {
                    "source": "VIIRS_NOAA20_NRT",
                    "west": 22.0,
                    "south": 44.0,
                    "east": 40.5,
                    "north": 52.5,
                    "start_date": "2026-11-01",
                    "end_date": "2026-11-05",
                },
            },
        )
    ]


def test_create_job_accepts_antimeridian_crossing_box_and_single_day(
    client: TestClient,
    send_task: SendTaskSpy,
    valid_payload: dict[str, object],
) -> None:
    payload = valid_payload | {"west": 170, "east": -170, "end_date": "2026-11-01"}

    response = client.post("/api/ingestion/jobs", json=payload)

    assert response.status_code == 202
    kwargs = send_task.calls[0][1]["kwargs"]
    assert (kwargs["west"], kwargs["east"]) == (170.0, -170.0)
    assert kwargs["start_date"] == kwargs["end_date"] == "2026-11-01"


@pytest.mark.parametrize("override", [
    {"source": "LANDSAT_NRT"},
    {"source": None},
    {"west": -180.5},
    {"east": 181},
    {"south": -91},
    {"north": 90.1},
    {"west": "not-a-number"},
    {"west": 30, "east": 30},
    {"south": 50, "north": 50},
    {"south": 51, "north": 50},
    {"start_date": "2026-13-01"},
    {"start_date": "yesterday"},
    {"start_date": "2026-11-06", "end_date": "2026-11-05"},
    {"area_id": 1},
])
def test_create_job_rejects_invalid_payload(
    client: TestClient,
    send_task: SendTaskSpy,
    valid_payload: dict[str, object],
    override: dict[str, object],
) -> None:
    response = client.post("/api/ingestion/jobs", json=valid_payload | override)

    assert response.status_code == 422
    assert send_task.calls == []


@pytest.mark.parametrize("field", [
    "source", "west", "south", "east", "north", "start_date", "end_date",
])
def test_create_job_rejects_missing_field(
    client: TestClient,
    send_task: SendTaskSpy,
    valid_payload: dict[str, object],
    field: str,
) -> None:
    payload = {key: value for key, value in valid_payload.items() if key != field}

    response = client.post("/api/ingestion/jobs", json=payload)

    assert response.status_code == 422
    assert send_task.calls == []


def test_create_job_rejects_missing_body(client: TestClient, send_task: SendTaskSpy) -> None:
    response = client.post("/api/ingestion/jobs")

    assert response.status_code == 422
    assert send_task.calls == []


def test_create_job_returns_503_when_the_broker_is_unavailable(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    valid_payload: dict[str, object],
) -> None:
    def broken_send_task(*args, **kwargs):
        raise OperationalError("redis://:secret-password@broker:6379/0 refused")

    monkeypatch.setattr(celery_app, "send_task", broken_send_task)

    response = client.post("/api/ingestion/jobs", json=valid_payload)

    assert response.status_code == 503
    assert response.json() == {"detail": "Task queue is currently unavailable."}
    assert "secret-password" not in response.text


@pytest.mark.parametrize("state", ["PENDING", "STARTED", "RETRY"])
def test_get_job_reports_unfinished_states_without_result_or_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    state: str,
) -> None:
    task_id = str(uuid4())
    # A result that must not leak while the task is not finished.
    spy = AsyncResultSpy(state, result={"message": "not finished"})
    monkeypatch.setattr(celery_app, "AsyncResult", spy)

    response = client.get(f"/api/ingestion/jobs/{task_id}")

    assert response.status_code == 200
    assert response.json() == {
        "task_id": task_id,
        "status": state,
        "result": None,
        "error": None,
    }
    assert spy.requested_ids == [task_id]


def test_get_job_returns_the_result_of_a_successful_task(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task_id = str(uuid4())
    result = {
        "source": "MODIS_NRT",
        "start_date": "2026-11-01",
        "end_date": "2026-11-05",
        "message": "Pipeline execution finished.",
    }
    monkeypatch.setattr(celery_app, "AsyncResult", AsyncResultSpy("SUCCESS", result))

    response = client.get(f"/api/ingestion/jobs/{task_id}")

    assert response.status_code == 200
    assert response.json() == {
        "task_id": task_id,
        "status": "SUCCESS",
        "result": result,
        "error": None,
    }


def test_get_job_hides_exception_details_of_a_failed_task(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task_id = str(uuid4())
    failure = RuntimeError(
        "GET https://firms.example/api/area/csv/SECRET-MAP-KEY/MODIS_NRT failed"
    )
    monkeypatch.setattr(celery_app, "AsyncResult", AsyncResultSpy("FAILURE", failure))

    response = client.get(f"/api/ingestion/jobs/{task_id}")

    assert response.status_code == 200
    assert response.json() == {
        "task_id": task_id,
        "status": "FAILURE",
        "result": None,
        "error": "Task execution failed. Check worker logs.",
    }
    assert "SECRET-MAP-KEY" not in response.text
    assert "RuntimeError" not in response.text


@pytest.mark.parametrize("task_id", ["not-a-uuid", "123", "5f0c1d6e-6f0a-4f0b-9a55"])
def test_get_job_rejects_non_uuid_task_id(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    task_id: str,
) -> None:
    spy = AsyncResultSpy("PENDING")
    monkeypatch.setattr(celery_app, "AsyncResult", spy)

    response = client.get(f"/api/ingestion/jobs/{task_id}")

    assert response.status_code == 422
    assert spy.requested_ids == []
