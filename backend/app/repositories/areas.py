from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.areas import Area


async def get_all_areas(
    session: AsyncSession,
) -> list[Area]:
    stmt = select(Area).order_by(Area.id)

    result = await session.scalars(stmt)

    return list(result.all())
