"""nhóm công việc nhỏ (subcategories) trong từng danh mục

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-21
"""
import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

SUBCATEGORIES = {
    "bao-cao-tai-lieu": [
        ("Biên bản họp", "bien-ban-hop"),
        ("Báo cáo định kỳ", "bao-cao-dinh-ky"),
        ("Soạn thảo văn bản", "soan-thao-van-ban"),
    ],
    "du-lieu-phan-tich": [
        ("Bảng tính & Excel", "bang-tinh"),
        ("Truy vấn SQL", "truy-van-sql"),
        ("Dashboard & trực quan hoá", "dashboard-truc-quan"),
    ],
    "lap-trinh": [
        ("Kiểm thử", "kiem-thu"),
        ("Review & refactor", "review-refactor"),
        ("Debug & sửa lỗi", "debug-sua-loi"),
        ("Tài liệu mã nguồn", "tai-lieu-ma-nguon"),
    ],
    "tu-dong-hoa": [
        ("CI/CD & triển khai", "ci-cd"),
        ("Lập lịch & workflow", "lap-lich"),
        ("Tích hợp API", "tich-hop-api"),
    ],
    "noi-dung-truyen-thong": [
        ("Viết bài & blog", "viet-bai"),
        ("Mạng xã hội", "mang-xa-hoi"),
        ("Hình ảnh & video", "hinh-anh-video"),
        ("SEO", "seo"),
    ],
    "nang-suat-van-phong": [
        ("Email & lịch họp", "email-lich-hop"),
        ("Ghi chú & công việc", "ghi-chu-cong-viec"),
    ],
    "marketing-ban-hang": [
        ("Chiến dịch & quảng cáo", "chien-dich-quang-cao"),
        ("CRM & khách hàng", "crm-khach-hang"),
        ("Thương mại điện tử", "thuong-mai-dien-tu"),
    ],
    "nhan-su": [
        ("Tuyển dụng", "tuyen-dung"),
        ("Onboarding", "onboarding"),
        ("Lương & phúc lợi", "luong-phuc-loi"),
    ],
    "tai-chinh-phap-che": [
        ("Kế toán & hoá đơn", "ke-toan-hoa-don"),
        ("Ngân sách & thuế", "ngan-sach-thue"),
        ("Hợp đồng & pháp lý", "hop-dong-phap-ly"),
    ],
}


def upgrade() -> None:
    op.create_table(
        "subcategories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.UniqueConstraint("category_id", "slug", name="uq_subcategory_slug"),
    )
    op.create_index("ix_subcategories_category_id", "subcategories", ["category_id"])
    with op.batch_alter_table("skills") as batch:
        batch.add_column(sa.Column("subcategory_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_skills_subcategory_id", "subcategories", ["subcategory_id"], ["id"])
        batch.create_index("ix_skills_subcategory_id", ["subcategory_id"])

    conn = op.get_bind()
    cat_ids = {slug: cid for cid, slug in conn.execute(sa.text("SELECT id, slug FROM categories"))}
    table = sa.table("subcategories", sa.column("category_id", sa.Integer), sa.column("name", sa.String), sa.column("slug", sa.String))
    rows = [
        {"category_id": cat_ids[cat], "name": name, "slug": slug}
        for cat, subs in SUBCATEGORIES.items() if cat in cat_ids
        for name, slug in subs
    ]
    if rows:
        op.bulk_insert(table, rows)


def downgrade() -> None:
    with op.batch_alter_table("skills") as batch:
        batch.drop_index("ix_skills_subcategory_id")
        batch.drop_constraint("fk_skills_subcategory_id", type_="foreignkey")
        batch.drop_column("subcategory_id")
    op.drop_index("ix_subcategories_category_id", table_name="subcategories")
    op.drop_table("subcategories")
