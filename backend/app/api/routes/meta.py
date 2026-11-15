from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.repositories.metadata import (
    get_last_ingested_at,
    get_source_metadata,
)
from app.schemas.meta import MetaResponse


router = APIRouter(
    prefix="/api",
    tags=["metadata"],
)


@router.get(
    "/meta",
    response_model=MetaResponse,
)
async def get_meta(
    session: AsyncSession = Depends(get_db),
) -> MetaResponse:
    source_metadata = await get_source_metadata(session)

    last_ingested_at = await get_last_ingested_at(session)

    return MetaResponse(
        **source_metadata,
        last_ingested_at=last_ingested_at,
    )
