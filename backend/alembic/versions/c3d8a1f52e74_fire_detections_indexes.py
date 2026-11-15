"""fire_detections indexes

The read endpoints filter by period, product and bounding box; until now the
table only had its primary key and the unique record_hash index.

Revision ID: c3d8a1f52e74
Revises: b7c2e4d91f03
Create Date: 2026-11-15 18:20:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c3d8a1f52e74'
down_revision: Union[str, Sequence[str], None] = 'b7c2e4d91f03'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        'ix_fire_detections_acquired_at',
        'fire_detections',
        ['acquired_at'],
    )
    op.create_index(
        'ix_fire_detections_lat_lon',
        'fire_detections',
        ['latitude', 'longitude'],
    )
    op.create_index(
        'ix_fire_detections_source_acquired',
        'fire_detections',
        ['source_product', 'acquired_at'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_fire_detections_source_acquired', table_name='fire_detections')
    op.drop_index('ix_fire_detections_lat_lon', table_name='fire_detections')
    op.drop_index('ix_fire_detections_acquired_at', table_name='fire_detections')
