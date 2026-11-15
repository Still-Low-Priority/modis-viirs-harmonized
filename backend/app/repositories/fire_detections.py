from typing import Any
from uuid import UUID
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fire_detections import FireDetection


# asyncpg accepts at most 32767 bind parameters per statement and a detection
# has about 20 columns, so one INSERT can carry roughly 1600 rows. FIRMS
# regularly returns more than that for a single period.
INSERT_CHUNK_SIZE = 1000


async def insert_fire_detections(
    session: AsyncSession,
    records: list[dict[str, Any]],
) -> int:
    inserted = 0

    for start in range(0, len(records), INSERT_CHUNK_SIZE):
        stmt = (
            insert(FireDetection)
            .values(records[start:start + INSERT_CHUNK_SIZE])
            .on_conflict_do_nothing(
                index_elements=[FireDetection.record_hash]
            )
            .returning(FireDetection.id)
        )

        result = await session.execute(stmt)
        inserted += len(result.scalars().all())

    return inserted
