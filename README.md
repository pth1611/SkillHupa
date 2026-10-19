# Skill Marketplace nội bộ

Nơi nhân viên tìm, cài và cập nhật skill (Claude Code, Cursor). Skill đến từ Creator trong công ty
hoặc được thu thập từ nguồn ngoài (GitHub), đều đi qua kiểm tra tự động và duyệt trước khi đăng.

## Trạng thái

| Phần | Trạng thái |
|---|---|
| `backend/` (FastAPI) | Đủ module theo thiết kế: users, auth, skills, reviews, installs, admin, sources, notifications, audit. 172 test |
| `frontend/` (React + Vite + MUI) | Xong: đăng nhập, bố cục, theme, vi/en, trang chủ, tìm kiếm, chi tiết skill, Skill của tôi, thông báo, Studio (wizard 3 bước), Duyệt (hàng đợi, cây file, diff, quyết định), Quản trị (bảng điều khiển, phân công, skill, tag, nhật ký + CSV, nguồn thu thập). 97 test |
| `cli/` (Node.js) | Xong: login (device code), install, list, outdated, update, uninstall; kiểm thử đầu-cuối với backend thật. 43 test. Cần thử với Entra ID thật |
| Azure Blob Storage | Xong và đã chạy với Azurite (`STORAGE_BACKEND=azure`): ghi/đọc blob, SAS URL chỉ đọc ngắn hạn. Đường Managed Identity (user delegation key) chưa thử được vì Azurite không hỗ trợ |
| PostgreSQL / Entra ID | PostgreSQL 16 thật: migration 0001–0006 chạy sạch, không lệch model, cả bộ test backend pass (xem "Test trên PostgreSQL"). Entra ID thật chưa thử |

Tài liệu thiết kế nằm ở [docs/](docs/): [architecture.md](docs/architecture.md) (quyết định D1–D51 ở mục 0,
điểm còn mở ở mục 12), [api.md](docs/api.md), [pipeline.md](docs/pipeline.md).

## Chạy thử nhanh (Docker)

```bash
cp .env.example .env            # rồi điền SESSION_SECRET (make secret để sinh một giá trị)
make up                         # PostgreSQL + migration + backend tại http://localhost:8000
# Tài liệu API: http://localhost:8000/api/docs
```

Với `DEV_LOGIN_ENABLED=true` (mặc định trong compose), đăng nhập thử bằng:

```bash
curl -c jar -X POST localhost:8000/api/auth/dev-login -H 'content-type: application/json' \
  -d '{"email":"manager@example.com","role":"manager","display_name":"Manager"}'
```

Các lệnh khác: `make logs`, `make down`, `make reset` (xoá dữ liệu cục bộ). Chạy tác vụ định kỳ một lần:
`docker compose --profile jobs run --rm job`.

## Phát triển backend không dùng Docker

```bash
make install                    # venv + thư viện (backend/.venv)
make db                         # chỉ chạy PostgreSQL trong Docker
cp backend/.env.example backend/.env   # điền SESSION_SECRET, DEV_LOGIN_ENABLED=true
make migrate && make dev        # API tại http://localhost:8000
make test                       # test dùng SQLite, không cần PostgreSQL
make lint                       # hoặc make fix; make check = lint + test
```

Frontend (cần Node.js 20+): `make fe-install`, rồi `make dev` (API) và `make fe-dev` (Vite tại
http://localhost:5173, proxy `/api` về cổng 8000). Ở màn hình đăng nhập của bản dev có form
"đăng nhập thử" khi backend bật `DEV_LOGIN_ENABLED`. `make fe-check` chạy typecheck, lint, test, i18n, build.

### Test trên PostgreSQL và Azurite

Mặc định test dùng SQLite (đã bật kiểm tra khoá ngoại như PostgreSQL). CI chạy cả bộ trên PostgreSQL 16. Để chạy cả bộ trên PostgreSQL thật, đặt `TEST_DATABASE_URL` trỏ tới một
database **dành riêng cho test** (test xoá và tạo lại bảng):

```bash
TEST_DATABASE_URL=postgresql+psycopg://skillmkt:skillmkt@localhost:5432/skilltest make test
```

Test tích hợp Azure Blob cần Azurite ở cổng 10000 và biến `AZURITE=1`
(`npx azurite --blobPort 10000`); không có thì các test đó tự bỏ qua.

Ruff trên máy áp bộ luật nghiêm: chạy `make fix` trước khi chốt thay đổi.

## Dùng CLI

```bash
cd cli && npm ci && npm run build && npm link      # cài lệnh `skillmkt` trên máy (Node.js 20+)
skillmkt login --server http://localhost:8000 --dev --role creator   # đăng nhập thử khi DEV_LOGIN_ENABLED
skillmkt install 12 --target claude-code           # <id> lấy trên trang chi tiết skill
skillmkt list                                      # skill đã cài và trạng thái
skillmkt outdated                                  # chỉ liệt kê, không đổi gì
skillmkt update [12]                               # tự chạy khi muốn cập nhật
skillmkt uninstall 12
```

Mặc định cài toàn cục (`~/.claude/skills`, `~/.cursor/skills`); thêm `--project` để cài theo thư mục hiện tại.
Dữ liệu CLI nằm ở `~/.skillmkt` (đổi bằng `SKILLMKT_HOME`); token nằm trong tệp quyền 600.
Với Entra ID thật, `skillmkt login --server <url>` dùng device code và lấy cấu hình từ `/api/auth/cli-config`
(cần `ENTRA_CLI_CLIENT_ID` và `ENTRA_CLI_SCOPE` ở backend).

## Cấu hình

Mọi cấu hình đi qua biến môi trường; danh sách và chú thích ở [backend/.env.example](backend/.env.example).
Các nhóm chính:

| Nhóm | Biến | Ghi chú |
|---|---|---|
| Phiên | `SESSION_SECRET` (≥ 32 ký tự), `COOKIE_SECURE` | Production bắt buộc `COOKIE_SECURE=true` |
| Entra ID | `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_API_AUDIENCE`, `ENTRA_GROUP_*` | Vai trò lấy từ nhóm Entra (D2) |
| Lịch làm việc | `WORK_SATURDAY_ANCHOR`, `WORK_HOLIDAYS`, `REVIEW_OVERDUE_DAYS`… | D18, D28, D31 |
| Phòng ban | `STANDARD_DEPARTMENTS` | Rỗng = không ràng buộc |
| Nguồn thu thập | `SOURCE_SCAN_INTERVAL_HOURS`, `SOURCE_TOKEN_*` | Token đọc từ biến môi trường, tên khai báo ở `credential_name` của nguồn; bắt buộc tiền tố `SOURCE_TOKEN_` |

Quy tắc kiểm tra tự động nằm ở [validation_rules.yaml](backend/app/modules/skills/validation_rules.yaml),
giấy phép được phép nhập ở [allowed_licenses.yaml](backend/app/modules/sources/allowed_licenses.yaml);
sửa hai file này qua pull request.

`.env` ở gốc có thể còn các biến `VLLM_*` không dùng trong thiết kế (xem mục 12 của architecture.md);
chúng vô hại và được giữ theo lựa chọn của người dùng.

## Cấu trúc

```
backend/
  app/core/        cấu hình, DB, lỗi, bảo mật, lưu trữ gói
  app/shared/      phân trang, lịch làm việc
  app/modules/     users, auth, skills, reviews, installs, admin, sources, notifications, audit
  app/jobs/        tác vụ định kỳ: python -m app.jobs.scheduled
  migrations/      Alembic (0001–0006)
  tests/
frontend/          React + TypeScript + Vite + MUI (src/api, auth, theme, i18n, components, features)
cli/               skillmkt: CLI Node.js + TypeScript (src/commands, test)
deploy/            nginx và cấu hình tham chiếu production (Azure Container Apps)
docs/              thiết kế, API, pipeline
```

Ranh giới giữa module: `reviews` chỉ gọi `skills` qua `skills/review_api.py`; `admin` dùng
`skills/review_api.py` và `skills/tags_api.py`; `sources` dùng `skills/import_api.py`.

## Triển khai

Azure Container Apps (backend, nginx + frontend tĩnh, hai Job), PostgreSQL Flexible Server, Blob Storage,
Key Vault. [deploy/docker-compose.prod.yml](deploy/docker-compose.prod.yml) ghi lại image, lệnh, biến môi
trường và lịch chạy để dựng IaC; [deploy/nginx/default.conf](deploy/nginx/default.conf) là cấu hình nginx
(SPA, proxy `/api`, header bảo mật). Chi tiết ở mục 10 của architecture.md và mục 3 của pipeline.md.

## Còn lại

Chạy thật với Entra ID (device code của CLI, nhóm vai trò, claim phòng ban), kiểm chứng đường Managed
Identity của Blob (user delegation key), pipeline CD lên Azure (cần IaC và thông tin hạ tầng),
bộ kết nối GitLab / Azure DevOps, tìm kiếm full-text của PostgreSQL (hiện dùng `LIKE`). Danh sách việc cần người khác cung cấp (nhóm Entra, phòng ban chuẩn,
kho npm nội bộ, ngày lễ, bộ tag ban đầu, nguồn và token) ở mục 12 của architecture.md.
