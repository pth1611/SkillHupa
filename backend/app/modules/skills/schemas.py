from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.skills.models import Visibility


class SkillMetadata(BaseModel):
    """Thông tin do Creator nhập; mọi trường tuỳ chọn ở bước tải gói, bắt buộc khi gửi duyệt."""

    name: str | None = Field(None, max_length=100)
    summary: str | None = Field(None, max_length=1000)
    category_id: int | None = None
    subcategory_id: int | None = None
    department: str | None = Field(None, max_length=255)
    visibility: Visibility | None = None
    version: str | None = Field(None, max_length=32)
    changelog: str | None = None
    tag_ids: list[int] = []
    output_types: list[str] = []
    ecosystems: list[str] = []


class VersionUpdate(BaseModel):
    version: str | None = Field(None, min_length=1, max_length=32)
    changelog: str | None = None


class SkillUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    summary: str | None = Field(None, max_length=1000)
    category_id: int | None = None
    subcategory_id: int | None = None
    department: str | None = Field(None, max_length=255)
    visibility: Visibility | None = None
    tag_ids: list[int] | None = None
    output_types: list[str] | None = None
    ecosystems: list[str] | None = None


class FindingOut(BaseModel):
    check: str
    result: str
    detail: str
    file_path: str | None = None
    line: int | None = None


class ValidationOut(BaseModel):
    phase: str
    ok: bool
    results: list[FindingOut]


class Prefill(BaseModel):
    name: str | None = None
    description: str | None = None
    version: str | None = None
    # Gợi ý phân loại tự động (classifier.py); wizard đổ sẵn, Creator xác nhận.
    output_types: list[str] = []
    ecosystems: list[str] = []
    category_slug: str | None = None
    subcategory_slug: str | None = None
    name_suggestion: str | None = None


class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    version: str
    status: str
    changelog: str | None = None
    checksum: str | None = None
    size_bytes: int | None = None
    created_at: datetime
    submitted_at: datetime | None = None
    # Chỉ điền cho chủ skill (xem góp ý và tiến độ duyệt ở Studio)
    review_decision: str | None = None
    review_comment: str | None = None
    assigned_to_name: str | None = None


class SkillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    summary: str | None = None
    category_id: int | None = None
    subcategory_id: int | None = None
    department: str | None = None
    visibility: str
    status: str
    origin: str
    output_types: list[str] = []
    ecosystems: list[str] = []
    # Slug do bộ phân loại tự động gán và chưa ai xác nhận (source=auto).
    auto_output_types: list[str] = []
    auto_ecosystems: list[str] = []
    owner_id: int | None = None
    latest_version_id: int | None = None
    download_count: int
    created_at: datetime
    updated_at: datetime


class SkillDetail(SkillOut):
    install_count: int = 0
    owner_name: str | None = None
    has_icon: bool = False
    tags: list[str] = []
    viewing_version: VersionOut | None = None
    source_url: str | None = None
    source_name: str | None = None
    upstream_author: str | None = None
    license: str | None = None
    upstream_status: str | None = None
    tag_ids: list[int] = []
    latest_version: VersionOut | None = None
    skill_md: str | None = None


class SkillMineItem(SkillOut):
    latest_draft_version: VersionOut | None = None


class CreateSkillResponse(BaseModel):
    skill: SkillOut
    version: VersionOut
    validation: ValidationOut
    prefill: Prefill


class VersionWithValidation(BaseModel):
    version: VersionOut
    validation: ValidationOut
    prefill: Prefill


class SkillCard(BaseModel):
    """Thẻ skill ở trang chủ và kết quả tìm kiếm."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    summary: str | None = None
    category_id: int | None = None
    department: str | None = None
    visibility: str
    origin: str
    source_name: str | None = None
    license: str | None = None
    latest_version: str | None = None
    has_icon: bool = False
    tags: list[str] = []
    output_types: list[str] = []
    ecosystems: list[str] = []
    install_count: int = 0
    download_count: int = 0
    published_at: datetime | None = None


class SubcategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    subcategories: list[SubcategoryOut] = []


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    status: str
    usage_count: int = 0


class TagProposal(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=50)


class DownloadOut(BaseModel):
    url: str
    expires_at: datetime | None = None
    version: str
    checksum: str | None = None


class SkillFileOut(BaseModel):
    path: str
    size: int
    is_text: bool


class SkillFileContentOut(BaseModel):
    path: str
    size: int
    is_text: bool
    too_large: bool
    content: str | None = None


class FacetsOut(BaseModel):
    """Số skill khớp theo từng giá trị phân loại, theo bộ lọc hiện tại (D52)."""

    total: int
    categories: dict[int, int]
    subcategories: dict[int, int] = {}
    output_types: dict[str, int]
    ecosystems: dict[str, int]


class TaxonomyOut(BaseModel):
    output_types: list[str]
    ecosystems: list[str]


class ClassificationUpdate(BaseModel):
    output_types: list[str] | None = None
    ecosystems: list[str] | None = None


class AutoClassifyRequest(BaseModel):
    force: bool = False  # True: ghi đè cả nhãn do người chọn


class ClassificationOut(BaseModel):
    output_types: list[str]
    ecosystems: list[str]


class AutoClassifyOut(ClassificationOut):
    applied: bool
    suggested_output_types: list[str]
    suggested_ecosystems: list[str]
    category_id: int | None
    subcategory_id: int | None = None
