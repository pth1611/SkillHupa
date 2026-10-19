"""skills, versions, files, validation results, tags

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-15
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.UniqueConstraint("name", name="uq_categories_name"),
        sa.UniqueConstraint("slug", name="uq_categories_slug"),
    )
    op.create_table(
        "skills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("name_key", sa.String(100), nullable=True),
        sa.Column("summary", sa.String(200), nullable=True),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("department", sa.String(255), nullable=True),
        sa.Column("visibility", sa.String(16), nullable=False, server_default="company"),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("origin", sa.String(16), nullable=False, server_default="internal"),
        sa.Column("source_id", sa.Integer(), nullable=True),
        sa.Column("source_url", sa.String(1000), nullable=True),
        sa.Column("upstream_author", sa.String(255), nullable=True),
        sa.Column("license", sa.String(64), nullable=True),
        sa.Column("upstream_status", sa.String(32), nullable=False, server_default="ok"),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("latest_version_id", sa.Integer(), nullable=True),
        sa.Column("download_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("name_key", name="uq_skills_name_key"),
    )
    op.create_index("ix_skills_owner_id", "skills", ["owner_id"])
    op.create_index("ix_skills_status", "skills", ["status"])
    op.create_table(
        "skill_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("skill_id", sa.Integer(), sa.ForeignKey("skills.id"), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("package_key", sa.String(255), nullable=True),
        sa.Column("icon_key", sa.String(255), nullable=True),
        sa.Column("skill_md", sa.Text(), nullable=True),
        sa.Column("checksum", sa.String(64), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("changelog", sa.Text(), nullable=True),
        sa.Column("source_ref", sa.String(255), nullable=True),
        sa.Column("source_commit", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("validation_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assigned_to", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("assigned_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("skill_id", "version", name="uq_skill_version"),
    )
    op.create_index("ix_skill_versions_skill_id", "skill_versions", ["skill_id"])
    op.create_index("ix_skill_versions_status", "skill_versions", ["status"])
    op.create_table(
        "skill_version_files",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("version_id", sa.Integer(), sa.ForeignKey("skill_versions.id"), nullable=False),
        sa.Column("path", sa.String(1000), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("is_text", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_skill_version_files_version_id", "skill_version_files", ["version_id"])
    op.create_table(
        "validation_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("version_id", sa.Integer(), sa.ForeignKey("skill_versions.id"), nullable=False),
        sa.Column("phase", sa.String(16), nullable=False),
        sa.Column("check_name", sa.String(100), nullable=False),
        sa.Column("result", sa.String(8), nullable=False),
        sa.Column("file_path", sa.String(1000), nullable=True),
        sa.Column("line", sa.Integer(), nullable=True),
        sa.Column("detail", sa.Text(), nullable=False),
    )
    op.create_index("ix_validation_results_version_id", "validation_results", ["version_id"])
    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("proposed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("name", name="uq_tags_name"),
    )
    op.create_index("ix_tags_status", "tags", ["status"])
    op.create_table(
        "skill_tags",
        sa.Column("skill_id", sa.Integer(), sa.ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", sa.Integer(), sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    )


def downgrade() -> None:
    op.drop_table("skill_tags")
    op.drop_index("ix_tags_status", table_name="tags")
    op.drop_table("tags")
    op.drop_index("ix_validation_results_version_id", table_name="validation_results")
    op.drop_table("validation_results")
    op.drop_index("ix_skill_version_files_version_id", table_name="skill_version_files")
    op.drop_table("skill_version_files")
    op.drop_index("ix_skill_versions_status", table_name="skill_versions")
    op.drop_index("ix_skill_versions_skill_id", table_name="skill_versions")
    op.drop_table("skill_versions")
    op.drop_index("ix_skills_status", table_name="skills")
    op.drop_index("ix_skills_owner_id", table_name="skills")
    op.drop_table("skills")
    op.drop_table("categories")
