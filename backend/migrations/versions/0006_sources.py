"""nguồn thu thập: skill_sources, source_scans, cột nguồn trên skills

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-15
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "skill_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("url", sa.String(1000), nullable=False),
        sa.Column("ref", sa.String(100), nullable=True),
        sa.Column("path_glob", sa.String(500), nullable=False, server_default=""),
        sa.Column("default_category_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=False),
        sa.Column("default_department", sa.String(255), nullable=False),
        sa.Column("default_visibility", sa.String(16), nullable=False, server_default="company"),
        sa.Column("credential_name", sa.String(100), nullable=True),
        sa.Column("is_internal", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_scan_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_scan_status", sa.String(8), nullable=True),
        sa.Column("last_scan_message", sa.String(500), nullable=True),
        sa.Column("scan_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("url", name="uq_skill_sources_url"),
    )
    op.create_table(
        "source_scans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("skill_sources.id"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("message", sa.String(500), nullable=True),
        sa.Column("triggered_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("commit", sa.String(64), nullable=True),
        sa.Column("counts", sa.JSON(), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
    )
    op.create_index("ix_source_scans_source_id", "source_scans", ["source_id"])
    op.add_column("skills", sa.Column("source_path", sa.String(500), nullable=True))
    op.add_column("skills", sa.Column("source_name", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("skills", "source_name")
    op.drop_column("skills", "source_path")
    op.drop_table("source_scans")
    op.drop_table("skill_sources")
