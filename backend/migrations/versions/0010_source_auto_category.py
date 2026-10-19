"""nguồn thu thập cho phép danh mục mặc định rỗng (tự động phân loại)

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-19
"""
import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("skill_sources") as batch:
        batch.alter_column("default_category_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("skill_sources") as batch:
        batch.alter_column("default_category_id", existing_type=sa.Integer(), nullable=False)
