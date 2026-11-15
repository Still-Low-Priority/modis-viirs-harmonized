import logging

from celery import Celery

from app.core.settings import get_celery_settings


# httpx logs every request URL at INFO, and FIRMS URLs contain the MAP_KEY.
logging.getLogger("httpx").setLevel(logging.WARNING)

celery_settings = get_celery_settings()

celery_app = Celery(
    "firms_ingestion",
    broker=celery_settings.CELERY_BROKER_URL.get_secret_value(),
    backend=celery_settings.CELERY_RESULT_BACKEND.get_secret_value(),
    include=["app.tasks.ingestion"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",

    timezone="UTC",
    enable_utc=True,

    task_track_started=True,
    worker_prefetch_multiplier=1,
)
