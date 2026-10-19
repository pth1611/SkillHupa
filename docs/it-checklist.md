# Checklist gửi IT: chạy thật Vita-skill

Mục đích: danh sách mọi thứ cần IT/đội liên quan cung cấp để chạy thật một vòng (SSO, CLI device code, Blob).
Tham chiếu: [architecture.md](architecture.md) mục 4 và 12, [../backend/.env.example](../backend/.env.example).

## 1. Entra ID (IT quản trị danh tính)

| # | Việc | Kết quả cần trả lại | Biến cấu hình |
|---|---|---|---|
| 1 | Tạo 3 nhóm bảo mật: `skillmkt-managers`, `skillmkt-reviewers`, `skillmkt-creators` (tên có thể khác) và quyết định ai quản lý thành viên | **Object ID** của từng nhóm | `ENTRA_GROUP_MANAGERS`, `ENTRA_GROUP_REVIEWERS`, `ENTRA_GROUP_CREATORS` |
| 2 | Tạo App registration **web** (single tenant). Redirect URI: `https://<domain>/api/auth/callback`. Tạo client secret | Tenant ID, Application (client) ID, client secret | `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_REDIRECT_URI` |
| 3 | Cấu hình claim `groups`: dùng "Groups assigned to the application" để tránh groups overage (giới hạn ~200 nhóm) | Xác nhận đã bật | |
| 4 | Bật claim `department` trong token (hoặc cho phép backend gọi Graph `/me`) | Xác nhận cách phát | |
| 5 | Expose API: đặt Application ID URI, tạo scope (ví dụ `access_as_user`) | Application ID URI | `ENTRA_API_AUDIENCE` |
| 6 | Tạo App registration **CLI**: public client, bật "Allow public client flows" (device code), cấp quyền scope ở mục 5, admin consent | Client ID, scope đầy đủ | `ENTRA_CLI_CLIENT_ID`, `ENTRA_CLI_SCOPE` |
| 7 | Gán nhóm ở mục 1 vào App registration web | Xác nhận | |

## 2. Azure hạ tầng

| # | Việc | Ghi chú |
|---|---|---|
| 1 | Subscription và resource group cho dự án | |
| 2 | Storage account + container `skills` | `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER` |
| 3 | Gán danh tính của backend (Managed Identity) role **Storage Blob Data Contributor** và **Storage Blob Delegator** | Cần cho user delegation key (SAS ngắn hạn) |
| 4 | PostgreSQL Flexible Server 16 | Chuỗi kết nối vào Key Vault |
| 5 | Key Vault chứa `SESSION_SECRET`, `ENTRA_CLIENT_SECRET`, `SOURCE_TOKEN_*`, chuỗi kết nối DB | |
| 6 | Container Apps environment, container registry, tên miền + chứng chỉ | Cần cho `COOKIE_SECURE=true` và redirect URI |

## 3. Thông tin nghiệp vụ

| # | Cần | Người cung cấp | Biến |
|---|---|---|---|
| 1 | Danh sách phòng ban chuẩn | IT / HR | `STANDARD_DEPARTMENTS` |
| 2 | Ngày mốc thứ bảy làm việc và ngày lễ năm đầu | HR | `WORK_SATURDAY_ANCHOR`, `WORK_HOLIDAYS` |
| 3 | Bộ tag ban đầu theo danh mục/phòng ban | Manager | nhập qua Quản trị |
| 4 | Nguồn GitHub thu thập ban đầu và token đọc (nếu repo riêng) | Manager / IT | `SOURCE_TOKEN_*` |
| 5 | Người phụ trách bảo mật duyệt [validation_rules.yaml](../backend/app/modules/skills/validation_rules.yaml) | Bảo mật | |
| 6 | Kho npm nội bộ (Azure Artifacts hoặc khác): feed, quyền đọc cho nhân viên, quyền publish | IT | đổi tên gói `@company/skillmkt` |

## 4. Kiểm tra sau khi nhận đủ

1. Đăng nhập web bằng 3 tài khoản thuộc 3 nhóm: đúng vai trò, đúng phòng ban.
2. `skillmkt login --server <url>`: device code, `skillmkt whoami` đúng người.
3. Đăng một skill, tải về qua SAS URL, kiểm tra URL hết hạn.
4. Người không thuộc nhóm nào: vai trò `user`; người đã nghỉ: không đăng nhập được.
