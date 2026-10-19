# Vita-skill nội bộ

Nơi nhân viên tìm, cài và cập nhật skill (Claude Code, Cursor). Skill đến từ Creator trong công ty
hoặc được thu thập từ nguồn ngoài (GitHub), đều đi qua kiểm tra tự động và duyệt trước khi đăng.

## Trạng thái

| Phần | Trạng thái |
|---|---|
| `backend/` (FastAPI) | Đủ module theo thiết kế: users, auth, skills, reviews, installs, admin, sources, notifications, audit. 206 test |
| `frontend/` (React + Vite + MUI) | Xong: đăng nhập, bố cục, theme, vi/en, trang chủ, tìm kiếm, chi tiết skill, Skill của tôi, thông báo, Studio (wizard 3 bước), Duyệt (hàng đợi, cây file, diff, quyết định), Quản trị (bảng điều khiển, phân công, skill, tag, nhật ký + CSV, nguồn thu thập). 98 test |
| `cli/` (Node.js) | Xong: login (device code), install, list, outdated, update, uninstall; kiểm thử đầu-cuối với backend thật. 43 test. Cần thử với Entra ID thật |
| Azure Blob Storage | Xong và đã chạy với Azurite (`STORAGE_BACKEND=azure`): ghi/đọc blob, SAS URL chỉ đọc ngắn hạn. Đường Managed Identity (user delegation key) chưa thử được vì Azurite không hỗ trợ |
| PostgreSQL / Entra ID | PostgreSQL 16 thật: migration 0001–0006 chạy sạch, không lệch model, cả bộ test backend pass (xem "Test trên PostgreSQL"). Entra ID thật chưa thử |

Tài liệu thiết kế nằm ở [docs/](docs/): [architecture.md](docs/architecture.md) (quyết định D1–D51 ở mục 0,
điểm còn mở ở mục 12), [api.md](docs/api.md), [pipeline.md](docs/pipeline.md).

## Chạy dự án

Cần Docker. Chạy thêm giao diện web cần Node.js 20+; chạy backend không qua Docker cần Python 3.11+.
Mọi lệnh chạy từ thư mục gốc của repo.

### Bước chung: tạo file `.env`

```bash
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # in ra một chuỗi ngẫu nhiên
```

Mở `.env`, dán chuỗi vừa in vào `SESSION_SECRET=`.

### Cách 1: Docker (nhanh nhất, chỉ backend + API)

```bash
docker compose up --build -d
```

API: http://localhost:8000 · Tài liệu API: http://localhost:8000/api/docs

Dừng: `docker compose down` (giữ dữ liệu) hoặc `docker compose down -v` (**xoá** dữ liệu cục bộ).
Xem log: `docker compose logs -f backend`.

### Cách 2: Chạy đầy đủ để phát triển (backend + giao diện web)

Cài một lần:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt     # thư viện backend
cd frontend && npm ci && cd ..                                     # thư viện frontend
docker compose up -d db                                            # bật PostgreSQL
cd backend && .venv/bin/alembic upgrade head && cd ..             # tạo bảng trong DB
```

Sau đó mở **hai terminal**:

```bash
# Terminal 1: API tại http://localhost:8000
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000

# Terminal 2: giao diện web tại http://localhost:5173
cd frontend && npm run dev
```

Mở http://localhost:5173. Ở màn hình đăng nhập có form "đăng nhập thử" (cần `DEV_LOGIN_ENABLED=true`,
đã bật sẵn trong `.env.example`). Lần sau chỉ cần bật lại PostgreSQL (`docker compose up -d db`)
và hai terminal trên.

### Kiểm tra code

```bash
cd backend && .venv/bin/python -m pytest -q                 # test backend (SQLite, không cần PostgreSQL)
cd backend && .venv/bin/ruff check . --exclude .venv --fix  # lint, tự sửa
cd frontend && npm run typecheck && npm run lint && npm test && npm run i18n:check && npm run build
```

Chạy tác vụ định kỳ một lần: `docker compose --profile jobs run --rm job`. Đăng nhập thử bằng curl:

```bash
curl -c jar -X POST localhost:8000/api/auth/dev-login -H 'content-type: application/json' \
  -d '{"email":"manager@example.com","role":"manager","display_name":"Manager"}'
```

### Test trên PostgreSQL và Azurite

Mặc định test dùng SQLite (đã bật kiểm tra khoá ngoại như PostgreSQL). CI chạy cả bộ trên PostgreSQL 16. Để chạy cả bộ trên PostgreSQL thật, đặt `TEST_DATABASE_URL` trỏ tới một
database **dành riêng cho test** (test xoá và tạo lại bảng):

```bash
cd backend && TEST_DATABASE_URL=postgresql+psycopg://skillmkt:skillmkt@localhost:5432/skilltest .venv/bin/python -m pytest -q
```

Test tích hợp Azure Blob cần Azurite ở cổng 10000 và biến `AZURITE=1`
(`npx azurite --blobPort 10000`); không có thì các test đó tự bỏ qua.

Ruff trên máy áp bộ luật nghiêm: chạy lệnh ruff ở mục "Kiểm tra code" trước khi chốt thay đổi.

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

Mọi cấu hình đi qua biến môi trường; file `.env` duy nhất ở thư mục gốc; danh sách đầy đủ và chú thích ở [backend/.env.example](backend/.env.example).
Các nhóm chính:

| Nhóm | Biến | Ghi chú |
|---|---|---|
| Phiên | `SESSION_SECRET` (≥ 32 ký tự), `COOKIE_SECURE` | Production bắt buộc `COOKIE_SECURE=true` |
| Entra ID | `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_API_AUDIENCE`, `ENTRA_GROUP_*` | Vai trò lấy từ nhóm Entra (D2) |
| Lịch làm việc | `WORK_SATURDAY_ANCHOR`, `WORK_HOLIDAYS`, `REVIEW_OVERDUE_DAYS`… | D18, D28, D31 |
| Phòng ban | `STANDARD_DEPARTMENTS` | Rỗng = không ràng buộc |
| Nguồn thu thập | `SOURCE_SCAN_INTERVAL_HOURS`, `SOURCE_TOKEN_*` | Token đọc từ biến môi trường, tên khai báo ở `credential_name` của nguồn; bắt buộc tiền tố `SOURCE_TOKEN_` |

Từ vựng loại đầu ra và ứng dụng (D52) nằm ở [taxonomy.yaml](backend/app/modules/skills/taxonomy.yaml).
Quy tắc kiểm tra tự động nằm ở [validation_rules.yaml](backend/app/modules/skills/validation_rules.yaml),
giấy phép được phép nhập ở [allowed_licenses.yaml](backend/app/modules/sources/allowed_licenses.yaml);
sửa các file này qua pull request.

`.env` ở gốc có thể còn các biến `VLLM_*` không dùng trong thiết kế (xem mục 12 của architecture.md);
chúng vô hại và được giữ theo lựa chọn của người dùng.

## Cấu trúc

```
backend/
  app/core/        cấu hình, DB, lỗi, bảo mật, lưu trữ gói
  app/shared/      phân trang, lịch làm việc
  app/modules/     users, auth, skills, reviews, installs, admin, sources, notifications, audit
  app/jobs/        tác vụ định kỳ: python -m app.jobs.scheduled
  migrations/      Alembic (0001–0007)
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
