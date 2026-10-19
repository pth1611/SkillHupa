"""facet ghi nguồn (người chọn hay bộ phân loại tự động) và điểm tin cậy

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-19
"""
import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("skill_facets", sa.Column("source", sa.String(8), nullable=False, server_default="manual"))
    op.add_column("skill_facets", sa.Column("score", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("skill_facets", "score")
    op.drop_column("skill_facets", "source")
