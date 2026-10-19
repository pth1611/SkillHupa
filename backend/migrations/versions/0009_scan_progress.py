"""tiến độ quét nguồn: tổng số thư mục skill cần xử lý

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-19
"""
import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("source_scans", sa.Column("total", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("source_scans", "total")
