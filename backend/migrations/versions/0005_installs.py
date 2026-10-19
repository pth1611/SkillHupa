"""installs

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-15
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "installs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("skill_id", sa.Integer(), sa.ForeignKey("skills.id"), nullable=False),
        sa.Column("installed_version", sa.String(32), nullable=False),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("target", sa.String(16), nullable=False),
        sa.Column("installed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("uninstalled_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("user_id", "skill_id", "target", name="uq_install_user_skill_target"),
    )
    op.create_index("ix_installs_user_id", "installs", ["user_id"])
    op.create_index("ix_installs_skill_id", "installs", ["skill_id"])


def downgrade() -> None:
    op.drop_table("installs")
