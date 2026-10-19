"""seed danh mục ban đầu

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-15
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

CATEGORIES = [
    ("Báo cáo & tài liệu", "bao-cao-tai-lieu"),
    ("Dữ liệu & phân tích", "du-lieu-phan-tich"),
    ("Lập trình", "lap-trinh"),
    ("Tự động hoá", "tu-dong-hoa"),
    ("Nội dung & truyền thông", "noi-dung-truyen-thong"),
    ("Khác", "khac"),
]


def upgrade() -> None:
    categories = sa.table("categories", sa.column("name", sa.String), sa.column("slug", sa.String))
    conn = op.get_bind()
    existing = {row[0] for row in conn.execute(sa.text("SELECT slug FROM categories"))}
    rows = [{"name": n, "slug": s} for n, s in CATEGORIES if s not in existing]
    if rows:
        op.bulk_insert(categories, rows)


def downgrade() -> None:
    slugs = [s for _, s in CATEGORIES]
    op.get_bind().execute(
        sa.text("DELETE FROM categories WHERE slug IN :slugs AND id NOT IN "
                "(SELECT category_id FROM skills WHERE category_id IS NOT NULL)").bindparams(
            sa.bindparam("slugs", slugs, expanding=True)
        )
    )
