from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fire_detections import FireDetection


INSERT_CHUNK_SIZE = 1000


async def insert_fire_detections(
    session: AsyncSession,
    records: list[dict[str, Any]],
) -> int:
    if not records:
        return 0

    inserted_count = 0

    for start in range(0, len(records), INSERT_CHUNK_SIZE):
        chunk = records[start:start + INSERT_CHUNK_SIZE]

        stmt = (
            insert(FireDetection)
            .values(chunk)
            .on_conflict_do_nothing(
                index_elements=[FireDetection.record_hash]
            )
            .returning(FireDetection.id)
        )

        result = await session.execute(stmt)
        inserted_count += len(result.scalars().all())

    return inserted_count

