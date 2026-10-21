"""mô tả ngắn của skill dài tới 1000 ký tự (mô tả thu thập từ SKILL.md hay dài hơn 200)

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-21
"""
import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("skills") as batch:
        batch.alter_column("summary", existing_type=sa.String(200), type_=sa.String(1000), existing_nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("skills") as batch:
        batch.alter_column("summary", existing_type=sa.String(1000), type_=sa.String(200), existing_nullable=True)
