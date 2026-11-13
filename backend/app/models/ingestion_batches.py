from sqlalchemy import CheckConstraint, DateTime, Date, Double, ForeignKey, Identity, Integer, String, Text, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime, date

from app.core.database import Base
from app.core.enums import BatchStatus

class IngestionBatch(Base):
    __tablename__ = "ingestion_batches"

    __table_args__ = (
        CheckConstraint(
            "west >= -180 AND west <= 180",
            name="ck_ingestion_batches_west_range",
        ),
        CheckConstraint(
            "east >= -180 AND east <= 180",
            name="ck_ingestion_batches_east_range",
        ),
        CheckConstraint(
            "south >= -90 AND south <= 90",
            name="ck_ingestion_batches_south_range",
        ),
        CheckConstraint(
            "north >= -90 AND north <= 90",
            name="ck_ingestion_batches_north_range",
        ),
        CheckConstraint(
            "west <> east",
            name="ck_ingestion_batches_longitude_not_equal",
        ),
        CheckConstraint(
            "south < north",
            name="ck_ingestion_batches_latitude_order",
        ),
        CheckConstraint(
            "date_from <= date_to",
            name="ck_ingestion_batches_date_range",
        ),
        CheckConstraint(
            "records_received >= 0",
            name="ck_ingestion_batches_received_nonnegative",
        ),
        CheckConstraint(
            "records_inserted >= 0",
            name="ck_ingestion_batches_inserted_nonnegative",
        ),
        CheckConstraint(
            "records_skipped >= 0",
            name="ck_ingestion_batches_skipped_nonnegative",
        ),
        CheckConstraint(
            "records_rejected >= 0",
            name="ck_ingestion_batches_rejected_nonnegative",
        )
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    source_product: Mapped[str] = mapped_column(String(32), nullable=False)
    area_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("areas.id", ondelete="SET NULL"), nullable=True)
    west: Mapped[float] = mapped_column(Double, nullable=False)
    south: Mapped[float] = mapped_column(Double, nullable=False)
    east: Mapped[float] = mapped_column(Double, nullable=False)
    north: Mapped[float] = mapped_column(Double, nullable=False)
    date_from: Mapped[date] = mapped_column(Date, nullable=False)
    date_to: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[BatchStatus] = mapped_column(
        SAEnum(
            BatchStatus,
            native_enum=False,
            create_constraint=True,
            values_callable=lambda enums_cls: [
                item.value for item in enums_cls
            ],
            name="batch_status"
        ), 
        nullable=False,
        default=BatchStatus.PENDING,
        server_default=BatchStatus.PENDING.value
    )
    records_received: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    records_inserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    records_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    records_rejected: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

