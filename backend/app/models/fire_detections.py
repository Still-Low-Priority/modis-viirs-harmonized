from sqlalchemy import BigInteger, Double, DateTime, ForeignKey, Identity, Integer, SmallInteger, String, CheckConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from app.core.database import Base
from app.core.enums import DayNight

class FireDetection(Base):
    __tablename__ = "fire_detections"

    __table_args__ = (
        CheckConstraint(
            "latitude >= -90 AND latitude <= 90",
            name="ck_fire_detections_latitude_range",
        ),
        CheckConstraint(
            "longitude >= -180 AND longitude <= 180",
            name="ck_fire_detections_longitude_range",
        ),
        CheckConstraint(
            "scan > 0",
            name="ck_fire_detections_scan_positive",
        ),
        CheckConstraint(
            "track > 0",
            name="ck_fire_detections_track_positive",
        ),
        CheckConstraint(
            "frp >= 0",
            name="ck_fire_detections_frp_nonnegative",
        )
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    source_product: Mapped[str] = mapped_column(String(32), nullable=False)
    latitude: Mapped[float] = mapped_column(Double, nullable=False)
    longitude: Mapped[float] = mapped_column(Double, nullable=False)
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    satellite: Mapped[str] = mapped_column(String(32), nullable=False)
    instrument: Mapped[str] = mapped_column(String(16), nullable=False)
    confidence_raw: Mapped[str] = mapped_column(String(16), nullable=False)
    detection_type: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    brightness: Mapped[float | None] = mapped_column(Double, nullable=True)
    bright_t31: Mapped[float | None] = mapped_column(Double, nullable=True)
    bright_ti4: Mapped[float | None] = mapped_column(Double, nullable=True)
    bright_ti5: Mapped[float | None] = mapped_column(Double, nullable=True)
    scan: Mapped[float] = mapped_column(Double, nullable=False)
    track: Mapped[float] = mapped_column(Double, nullable=False)
    frp: Mapped[float] = mapped_column(Double, nullable=False)
    daynight: Mapped[DayNight] = mapped_column(
        SAEnum(
            DayNight,
            native_enum=False,
            create_constraint=True,
            values_callable=lambda enum_cls: [
                item.value for item in enum_cls
            ],
            name="daynight"
        ),
        nullable=False
    )
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    ingestion_batch_id: Mapped[int] = mapped_column(Integer, ForeignKey("ingestion_batches.id", ondelete="RESTRICT"), nullable=False)
    record_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
