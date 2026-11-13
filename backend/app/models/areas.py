from datetime import datetime
from sqlalchemy import DateTime, Identity, Integer, String, Text, Double, CheckConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

class Area(Base):
    __tablename__ = "areas"

    __table_args__ = (
        CheckConstraint(
            "west >= -180 AND west <= 180",
            name="ck_areas_west_range",
        ),
        CheckConstraint(
            "east >= -180 AND east <= 180",
            name="ck_areas_east_range",
        ),
        CheckConstraint(
            "south >= -90 AND south <= 90",
            name="ck_areas_south_range",
        ),
        CheckConstraint(
            "north >= -90 AND north <= 90",
            name="ck_areas_north_range",
        ),
        CheckConstraint(
            "west <> east",
            name="ck_areas_longitude_not_equal",
        ),
        CheckConstraint(
            "south < north",
            name="ck_areas_latitude_order",
        ),
        CheckConstraint(
            "updated_at >= created_at",
            name="ck_areas_updated_after_created",
        ),
        CheckConstraint(
            "country_code IS NULL OR length(country_code) = 2",
            name="ck_areas_country_code_length",
        )
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    west: Mapped[float] = mapped_column(Double, nullable=False)
    south: Mapped[float] = mapped_column(Double, nullable=False)
    east: Mapped[float] = mapped_column(Double, nullable=False)
    north: Mapped[float] = mapped_column(Double, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

