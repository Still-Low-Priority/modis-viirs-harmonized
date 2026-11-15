from celery import Celery
from celery.schedules import crontab

from app.core.settings import get_celery_settings

celery_settings = get_celery_settings()

celery_app = Celery(
    "firms_ingestion",
    broker=celery_settings.CELERY_BROKER_URL.get_secret_value(),
    backend=celery_settings.CELERY_RESULT_BACKEND.get_secret_value(),
    include=[
        "app.tasks.ingestion",
        "app.tasks.scheduler",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",

    timezone="UTC",
    enable_utc=True,

    task_track_started=True,
    worker_prefetch_multiplier=1,

    beat_schedule={
        "nrt-ingestion-every-six-hours": {
            "task": "app.tasks.scheduler.schedule_nrt_ingestion",
            "schedule": crontab(
                minute=0,
                hour="*/6",
            ),
        },
    },
)
