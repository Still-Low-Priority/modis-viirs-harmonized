"""fire_detections: nullable detection_type, default for ingested_at

FIRMS NRT products have no "type" column, so detection_type cannot be
NOT NULL; ingested_at is filled by the database on insert.

Revision ID: b7c2e4d91f03
Revises: 6a1398cf4228
Create Date: 2026-11-15 15:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c2e4d91f03'
down_revision: Union[str, Sequence[str], None] = '6a1398cf4228'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        'fire_detections',
        'detection_type',
        existing_type=sa.SmallInteger(),
        nullable=True,
    )
    op.alter_column(
        'fire_detections',
        'ingested_at',
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=False,
        server_default=sa.text('now()'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        'fire_detections',
        'ingested_at',
        existing_type=sa.DateTime(timezone=True),
        existing_nullable=False,
        server_default=None,
    )
    # Fails while NRT rows (detection_type IS NULL) exist; remove them first.
    op.alter_column(
        'fire_detections',
        'detection_type',
        existing_type=sa.SmallInteger(),
        nullable=False,
    )
