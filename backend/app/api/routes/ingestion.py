from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from kombu.exceptions import OperationalError

from app.celery_app import celery_app
from app.schemas.ingestion import (
    IngestionJobCreate,
    IngestionJobAccepted,
    IngestionJobStatus,
)


router = APIRouter(
    prefix="/api/ingestion",
    tags=["ingestion"],
)


@router.post(
    "/jobs",
    response_model=IngestionJobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_ingestion_job(
    payload: IngestionJobCreate,
) -> IngestionJobAccepted:
    try:
        task = celery_app.send_task(
            "app.tasks.ingestion.run_firms_ingestion",
            kwargs={
                "source": payload.source.value,
                "west": payload.west,
                "south": payload.south,
                "east": payload.east,
                "north": payload.north,
                "start_date": payload.start_date.isoformat(),
                "end_date": payload.end_date.isoformat(),
            },
        )
    except OperationalError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Task queue is currently unavailable.",
        ) from exc

    return IngestionJobAccepted(
        task_id=task.id,
    )


@router.get(
    "/jobs/{task_id}",
    response_model=IngestionJobStatus,
)
def get_ingestion_job(
    task_id: UUID,
) -> IngestionJobStatus:
    task_result = celery_app.AsyncResult(str(task_id))

    response = IngestionJobStatus(
        task_id=str(task_id),
        status=task_result.state,
    )

    if task_result.state == "SUCCESS":
        response.result = task_result.result

    elif task_result.state == "FAILURE":
        response.error = "Task execution failed. Check worker logs."

    return response

