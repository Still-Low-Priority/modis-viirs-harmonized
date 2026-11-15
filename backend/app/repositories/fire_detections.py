from typing import Any
from uuid import UUID
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fire_detections import FireDetection


async def insert_fire_detections(
    session: AsyncSession,
    records: list[dict[str, Any]],
) -> int:
    if not records:
        return 0

    stmt = (
        insert(FireDetection)
        .values(records)
        .on_conflict_do_nothing(
            index_elements=[FireDetection.record_hash]
        )
        .returning(FireDetection.id)
    )

    result = await session.execute(stmt)

    return len(result.scalars().all())
