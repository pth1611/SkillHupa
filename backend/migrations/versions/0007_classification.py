"""phân loại theo loại đầu ra và hệ sinh thái; thêm danh mục

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-19
"""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

NEW_CATEGORIES = [
    ("Năng suất & văn phòng", "nang-suat-van-phong"),
    ("Marketing & bán hàng", "marketing-ban-hang"),
    ("Nhân sự", "nhan-su"),
    ("Tài chính & pháp chế", "tai-chinh-phap-che"),
]


def upgrade() -> None:
    op.create_table(
        "skill_facets",
        sa.Column("skill_id", sa.Integer(), sa.ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("kind", sa.String(16), primary_key=True),
        sa.Column("slug", sa.String(50), primary_key=True),
    )
    op.create_index("ix_skill_facets_kind_slug", "skill_facets", ["kind", "slug"])

    categories = sa.table("categories", sa.column("name", sa.String), sa.column("slug", sa.String))
    conn = op.get_bind()
    existing = {row[0] for row in conn.execute(sa.text("SELECT slug FROM categories"))}
    rows = [{"name": n, "slug": s} for n, s in NEW_CATEGORIES if s not in existing]
    if rows:
        op.bulk_insert(categories, rows)


def downgrade() -> None:
    op.drop_index("ix_skill_facets_kind_slug", table_name="skill_facets")
    op.drop_table("skill_facets")
    slugs = [s for _, s in NEW_CATEGORIES]
    op.get_bind().execute(
        sa.text("DELETE FROM categories WHERE slug IN :slugs AND id NOT IN "
                "(SELECT category_id FROM skills WHERE category_id IS NOT NULL)").bindparams(
            sa.bindparam("slugs", slugs, expanding=True)
        )
    )
