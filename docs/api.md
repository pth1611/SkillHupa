# API – Skill Marketplace

> Trạng thái: **thiết kế mục tiêu.** Chưa có code; mỗi nhóm endpoint tương ứng một `router.py` trong `backend/app/modules/`. Nghiệp vụ và quyết định gốc xem [architecture.md](architecture.md) (D1–D51).

## 1. Quy ước chung

| Mục | Quy ước |
|---|---|
| Tiền tố | `/api` (chưa đánh số phiên bản; thêm `/v2` khi có thay đổi phá vỡ) |
| Định dạng | JSON, UTF-8; tải gói dùng `multipart/form-data` |
| Xác thực | Cookie phiên (website) hoặc `Authorization: Bearer <Entra token>` (CLI) |
| Thời gian | ISO 8601, UTC |
| Định danh | Số nguyên (`id`) |
| Phân trang | `?page=1&page_size=20` (tối đa 100); trả `{ items, total, page, page_size }` |
| Sắp xếp | `?sort=` với giá trị cố định theo từng endpoint |
| Phiên bản skill | Đường dẫn dưới `/api/skills/{id}/...` dùng chuỗi semver (`1.2.0`; tải gói chấp nhận thêm `latest`). Đường dẫn dưới `/api/reviews/...` dùng `version_id` số nguyên |
| CSRF | Với cookie phiên, mọi `POST/PUT/PATCH/DELETE` phải kèm header `X-CSRF-Token`; request dùng Bearer không cần |
| Thứ tự route | `/api/skills/featured` và `/api/skills/mine` khai báo **trước** `/api/skills/{id}` |

### Lỗi

```json
{ "error": { "code": "VERSION_NOT_GREATER", "message": "Phiên bản phải lớn hơn 1.2.0", "details": {} } }
```

| HTTP | Khi nào |
|---|---|
| 400 | Dữ liệu sai định dạng |
| 401 | Chưa đăng nhập hoặc phiên hết hạn |
| 403 | Đã đăng nhập nhưng vai trò không được phép |
| 404 | Không tồn tại **hoặc** không có quyền xem skill (D19, không lộ sự tồn tại) |
| 409 | Sai trạng thái (ví dụ gửi duyệt phiên bản không ở `draft`) hoặc trùng |
| 413 | Gói vượt giới hạn kích thước (D15) |
| 422 | Kiểm tra tự động có `fail` (kèm danh sách kết quả) |
| 429 | Vượt giới hạn tần suất |

Cột **Quyền** dưới đây: `U` = mọi người đã đăng nhập, `C` = Creator (và chủ skill), `R` = Reviewer, `M` = Manager. Quyền xem skill luôn chịu thêm bộ lọc phạm vi xem (D19).

## 2. Hệ thống

Module: `main.py`.

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/health` | công khai | Backend còn sống |
| GET | `/api/health/ready` | công khai | Kết nối DB và Blob bình thường |

## 3. auth

Module: `modules/auth`.

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/auth/cli-config` | công khai | Thông tin công khai để CLI đăng nhập device code: `tenant_id`, `client_id`, `scope`, `sso_configured`, `dev_login` (không có bí mật). Nhờ đó người dùng chỉ cần biết địa chỉ máy chủ |
| GET | `/api/auth/login` | công khai | Chuyển hướng sang Entra (code + PKCE) |
| GET | `/api/auth/callback` | công khai | Nhận `code`, đồng bộ user/vai trò/phòng ban, đặt cookie phiên |
| POST | `/api/auth/logout` | U | Xoá phiên của website |
| GET | `/api/auth/me` | U | Người dùng hiện tại: `id`, `email`, `display_name`, `role`, `department`, `unread_notifications` |
| POST | `/api/auth/dev-login` | công khai (chỉ dev) | Đăng nhập giả để phát triển/test: `{ email, role, department, display_name }`. Trả `404` trừ khi `DEV_LOGIN_ENABLED=true` và `ENVIRONMENT` khác `production`; ứng dụng từ chối khởi động nếu bật ở production |

## 4. users

Module: `modules/users`.

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/users` | M | Tìm người dùng (`q`, `role`, `department`); dùng khi chuyển quyền sở hữu |

Không có endpoint tạo, sửa vai trò hay xoá: vai trò và phòng ban lấy từ Entra (D2, D20).

## 5. skills

Module: `modules/skills`.

### Xem và tìm kiếm

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/skills` | U | Tìm/lọc skill `published`: `q`, `category`, `department`, `tag` (lặp được), `sort=newest\|popular\|name`, phân trang |
| GET | `/api/skills/featured` | U | Skill nổi bật cho trang chủ (D21) |
| GET | `/api/skills/{id}` | U | Chi tiết, gồm `origin` (`internal\|imported`) và với skill thu thập: `source_url`, `upstream_author`, `license` (người thường chỉ xem được phiên bản `published`/`revoked`; chủ skill, R, M xem thêm bản khác): `summary`, `skill_md` (của bản đang xem, `?version=`), tag, `latest_version`, `install_count`, `download_count`. `skill_md` là Markdown thô, **client phải làm sạch** khi hiển thị. Thêm: `tags` (tên tag đã duyệt), `owner_name`, `has_icon`, và `viewing_version` (phiên bản đang xem: mặc định bản mới nhất, hoặc `?version=`; `404` nếu không có hoặc không được xem) |
| GET | `/api/skills/{id}/versions` | U | Lịch sử phiên bản `published` và `revoked`, kèm changelog. Chủ skill, R và M thấy thêm các bản `draft`, `pending`, `rejected` |
| GET | `/api/skills/{id}/icon` | U | Ảnh biểu tượng của phiên bản `published` mới nhất (WebP); có kiểm tra phạm vi xem; hỗ trợ cache trình duyệt. Chủ skill, R, M thêm `?version=` để xem ảnh của bản chưa đăng |
| GET | `/api/skills/{id}/download` | U | Cấp SAS URL tải gói. Tham số: `version` (mặc định `latest`), `intent=install\|zip` |
| GET | `/api/categories` | U | Danh sách danh mục |
| GET | `/api/departments` | U | Danh sách phòng ban chuẩn |
| GET | `/api/tags` | U | Tag `approved` (`q`, `limit`), xếp theo mức dùng |
| POST | `/api/tags/proposals` | C | Đề xuất tag mới: `{ "name": "excel" }`; trả tag `pending`, hoặc tag có sẵn nếu trùng |
| GET | `/api/tags/proposals/mine` | C | Tag tôi đã đề xuất và trạng thái |

`download`: trả `{ "url": "<SAS>", "expires_at": "...", "version": "1.2.0", "checksum": "sha256:..." }`. Với `intent=zip` hệ thống tăng `download_count` và ghi (hoặc cập nhật) một bản ghi `installs` với `source = zip` cho người gọi (D41); với `intent=install` thì không ghi gì (lượt cài được đếm khi CLI gọi `POST /api/installs`). Lưu ý: đây là `GET` có tác dụng phụ; nếu cần tách bạch, đổi thành `POST /api/skills/{id}/download`. Phiên bản `revoked` không được cấp.

### Quản lý skill của Creator

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/skills/mine` | C | Skill của tôi (mọi trạng thái), kèm trạng thái phiên bản mới nhất |
| POST | `/api/skills` | C | Tạo skill và phiên bản đầu (`multipart`: `metadata` JSON + `package` .zip + `icon` tùy chọn) → skill `draft`, phiên bản `draft`; **chạy kiểm tra xem trước (D42)**. Trả `201` với `{ skill, version, validation: { results[] }, prefill: { name, description, version } }`; lỗi `fail` không làm request lỗi, chỉ nằm trong `validation`. `metadata` là chuỗi JSON, **mọi trường tuỳ chọn ở bước này** (wizard bước 1 chỉ tải gói; thiếu thì lấy từ `SKILL.md`: tên, phiên bản): `name`, `summary` (tối đa 200 ký tự), `category_id`, `department` (mặc định phòng ban của người tạo), `visibility`, `version`, `changelog`, `tag_ids`. `summary`, `category_id` và `department` bắt buộc khi `submit`. `tag_ids` chỉ nhận tag `approved` (hoặc tag `pending` của chính người tạo) |
| PATCH | `/api/skills/{id}` | C (chủ) | Sửa `summary`, danh mục, tag, `visibility`, `department` (phải thuộc danh sách phòng ban chuẩn). Thu hẹp `visibility` áp dụng ngay (`200`). Mở rộng (`department` → `company`, hoặc đổi `department` sang phòng ban khác) trả `202` kèm `{ skill, visibility_request: { id, status, to_visibility } }`, phạm vi cũ giữ nguyên trong lúc chờ (D27); đang có yêu cầu chờ thì `409`. Đổi `name` của skill đã đăng trả `409` |
| POST | `/api/skills/{id}/versions` | C (chủ) | Tải phiên bản mới (`multipart`: `version`, `changelog`, `package`, `icon` tùy chọn) → `draft` |
| PATCH | `/api/skills/{id}/versions/{version}` | C (chủ) | Sửa `version` (semver, lớn hơn mọi bản đã đăng) và `changelog` của phiên bản `draft`/`rejected` (wizard bước 2); chạy lại kiểm tra xem trước, trả `{ version, validation, prefill }`; bản bị từ chối sửa xong quay về `draft`. `409` nếu số phiên bản đã có |
| PUT | `/api/skills/{id}/versions/{version}/icon` | C (chủ) | Thay ảnh biểu tượng của phiên bản đang `draft` (`multipart`: `icon`) |
| PUT | `/api/skills/{id}/versions/{version}/package` | C (chủ) | Thay gói của phiên bản đang `draft`; chạy lại kiểm tra xem trước, trả `validation` như trên |
| DELETE | `/api/skills/{id}/versions/{version}` | C (chủ) | Xoá phiên bản `draft`/`rejected` chưa từng đăng |
| POST | `/api/skills/{id}/versions/{version}/submit` | C (chủ) | Gửi duyệt: chạy kiểm tra tự động **đồng bộ** (D25) |
| GET | `/api/skills/{id}/versions/{version}/validation` | C (chủ), R, M | Kết quả kiểm tra tự động (`?phase=preview\|submit`, mặc định kết quả mới nhất; R và M chỉ thấy `submit`) |

`submit`:
- Thiếu thông tin bắt buộc (`name`, `summary`, `category_id`, `department`) → `422`, `error.code = SUBMISSION_INCOMPLETE`, `error.details.fields` liệt kê trường thiếu; không chạy kiểm tra.
- Có `fail` → `422`, `error.code = VALIDATION_FAILED`, `error.details.results = [ { check, result, file_path, line, detail } ]`; phiên bản về `draft` và kết quả vẫn được lưu (xem `GET .../validation?phase=submit`).
- Không có `fail` → `200`, phiên bản `pending`, kèm `warn` nếu có.
- Gói bất biến từ lúc `pending`; `checksum` được ghi lúc này.
- Phiên bản không ở `draft` thì trả `409`.

## 6. reviews

Module: `modules/reviews`. Việc duyệt do Manager phân công (D26); gồm hai loại việc: phiên bản chờ duyệt (`type=version`) và yêu cầu mở rộng phạm vi xem (`type=visibility`, D27).

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/reviews/queue` | R, M | R: việc **được giao cho mình**. M: toàn bộ hàng đợi. Lọc: `type`, `assigned=true\|false`, `reviewer_id`, `overdue=true`, `sort=oldest` |
| GET | `/api/reviews/versions/{version_id}` | R (được giao), M | Chi tiết cần duyệt: metadata, danh sách file, kết quả kiểm tra tự động (kể cả `warn`) |
| GET | `/api/reviews/versions/{version_id}/icon` | R (được giao), M | Ảnh biểu tượng (WebP) của phiên bản đang duyệt (D39); `404` nếu không có ảnh. Chi tiết phiên bản có thêm `has_icon`, `owner_name`, `assigned_by_name` |
| GET | `/api/reviews/versions/{version_id}/files` | R (được giao), M | Cây file kèm nhãn `added\|modified\|removed\|unchanged` so với bản `latest` đang phục vụ, `size`, `is_text`, số cảnh báo theo file |
| GET | `/api/reviews/versions/{version_id}/files/content` | R (được giao), M | `?path=`; trả nội dung văn bản, và `diff` (unified) so với bản gốc. Nhị phân hoặc quá 256 KB: chỉ trả metadata |
| GET | `/api/reviews/versions/{version_id}/package` | R (được giao), M | SAS URL ngắn hạn để tải cả gói |
| PUT | `/api/reviews/versions/{version_id}/assignment` | M | Phân công hoặc giao lại: `{ "reviewer_id": 12 }`; người được giao phải có vai trò Reviewer |
| DELETE | `/api/reviews/versions/{version_id}/assignment` | M | Bỏ phân công (về lại hàng chưa giao) |
| POST | `/api/reviews/versions/{version_id}/decision` | R (được giao) | Body `{ "decision": "approved\|rejected", "comment": "..." }`; `comment` bắt buộc khi `rejected` (D17) |
| GET | `/api/reviews/visibility-requests/{id}` | R (được giao), M | Chi tiết yêu cầu: skill, người yêu cầu, phạm vi hiện tại và đề nghị, nội dung skill để đối chiếu |
| PUT | `/api/reviews/visibility-requests/{id}/assignment` | M | Phân công người duyệt cho yêu cầu mở rộng phạm vi |
| POST | `/api/reviews/visibility-requests/{id}/decision` | R (được giao) | `{ "decision": "approved\|rejected", "comment": "..." }`; duyệt thì áp dụng `visibility` mới |
| GET | `/api/reviews/history` | R | Các quyết định tôi đã đưa ra |

- Reviewer gọi vào việc không được giao cho mình nhận `404` (không lộ việc của người khác); phiên bản không ở `pending` trả `409`; từ chối thiếu góp ý trả `422 COMMENT_REQUIRED`; người được giao không phải Reviewer đang hoạt động trả `422 INVALID_ASSIGNEE`.
- `GET /api/reviews/queue` trả mỗi mục: `kind` (`version`\|`visibility`), `id`, `skill_id`, `skill_name`, `origin`, `version`, `from_visibility`/`to_visibility`, `submitted_at`, `assigned_to`, `assigned_to_name`, `overdue`, `unassigned_overdue`.
- `GET /api/reviews/versions/{id}/package` hiện trả thẳng file `.zip` (bản cục bộ); trên Azure sẽ đổi thành SAS URL ngắn hạn.
- `approve` kiểm tra lại `checksum` của gói; không khớp trả `409`.
- Với phiên bản, `decision` kiểm tra lại `checksum`, ghi `reviews`, đổi trạng thái, tạo thông báo, ghi `audit_logs`.
- Phân công và giao lại đều ghi `audit_logs` và thông báo Reviewer mới; giao lại thông báo cả người cũ.
- Manager **không** có endpoint `decision`.
- Tự động chia việc quá 3 ngày (D28) không đi qua API công khai: tác vụ định kỳ gọi lệnh nội bộ của backend (không phải endpoint HTTP). Kết quả vẫn hiện qua `assignment` với `assigned_by = system`.

## 7. installs

Module: `modules/installs`. Dùng cho trang "Skill của tôi" và CLI (D11, D12).

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/installs/me` | U | Skill tôi đã cài hoặc đã tải `.zip`, kèm `state`, `source` (`cli\|zip`), `installed_version`, `latest_version`; lọc `state=`, phân trang |
| POST | `/api/installs` | U | CLI báo đã cài/cập nhật: `{ skill_id, version, target }`; server đặt `source = cli`. Idempotent theo (user, skill, target). Bản ghi `source = zip` do `download?intent=zip` tạo, không qua endpoint này |
| DELETE | `/api/installs/{skill_id}` | U | CLI báo đã gỡ, hoặc web "Ẩn" mục `zip` (`?target=`); ghi `uninstalled_at` |
| POST | `/api/installs/check` | U | CLI gửi `[{ skill_id, version }]`, nhận lại `state` từng mục |

`state`:

| Giá trị | Ý nghĩa |
|---|---|
| `up_to_date` | Đang ở bản `latest` |
| `update_available` | Có bản `published` mới hơn |
| `revoked` | Bản đang cài đã bị thu hồi (D9) |
| `removed` | Skill đã bị gỡ (D10) |
| `no_access` | Không còn quyền xem (đổi phòng ban) |

## 8. notifications

Module đề xuất: `modules/notifications` (D6).

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/notifications` | U | Thông báo của tôi (`unread=true`, phân trang) |
| POST | `/api/notifications/{id}/read` | U | Đánh dấu đã đọc |
| POST | `/api/notifications/read-all` | U | Đánh dấu tất cả đã đọc |

Website lấy số chưa đọc từ `/api/auth/me` và làm mới định kỳ; chưa dùng đẩy thời gian thực.

## 9. admin

Module: `modules/admin` (chỉ Manager). Mọi thao tác ghi `audit_logs` và thông báo chủ skill.

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/admin/sources` | Danh sách nguồn thu thập kèm `last_scan_at`, `last_scan_status`, số skill đã nhập |
| POST | `/api/admin/sources` | Khai báo nguồn: `{ type, url, ref, path_glob, default_category, default_department, default_visibility, credential_name, internal }` |
| PATCH | `/api/admin/sources/{id}` | Sửa nguồn hoặc bật/tắt (`is_enabled`) |
| DELETE | `/api/admin/sources/{id}` | Xoá nguồn; skill đã nhập được giữ lại, không còn đồng bộ |
| POST | `/api/admin/sources/{id}/scan` | Quét ngay; trả `202` kèm kết quả tóm tắt khi xong (hoặc `409` nếu đang quét) |
| GET | `/api/admin/sources/{id}/scans` | Lịch sử quét: skill mới, bỏ qua (kèm lý do: thiếu giấy phép, giấy phép không cho phép, kiểm tra tự động lỗi) |
| PATCH | `/api/admin/skills/{id}` | Sửa thông tin hiển thị của skill thu thập (`summary`, `category`, `department`, `visibility`, tag); không sửa được nội dung gói |
| GET | `/api/admin/dashboard` | Số liệu bảng điều khiển: `unassigned`, `unassigned_overdue`, `review_overdue`, `tags_pending`, `visibility_requests_pending`, `sources_with_problems`, sự kiện gỡ/thu hồi gần đây, tổng quan |
| GET | `/api/admin/skills` | Mọi skill ở mọi trạng thái (`status`, `q`, `owner_id`) |
| GET | `/api/admin/skills/{id}/impact` | Tác động của gỡ/thu hồi: `installed_users`, `zip_users`, `latest_after_revoke` (kèm `?version=`) để hộp xác nhận hiển thị |
| POST | `/api/admin/skills/{id}/remove` | Gỡ mềm (D10); body `{ "reason": "..." }` bắt buộc |
| POST | `/api/admin/skills/{id}/restore` | Khôi phục skill đã gỡ |
| POST | `/api/admin/skills/{id}/transfer` | Chuyển quyền sở hữu: `{ "new_owner_id": 12 }`; chỉ cho người có vai trò Creator |
| POST | `/api/admin/skills/{id}/versions/{version}/revoke` | Thu hồi phiên bản (D9); `latest_version_id` quay về bản tốt gần nhất; `reason` bắt buộc. `409` nếu đây là bản `published` cuối cùng (dùng `remove`) |
| GET | `/api/admin/audit-logs` | Nhật ký: `actor_id`, `action`, `target_type`, `target_id`, `from`, `to`, phân trang |
| GET | `/api/admin/audit-logs/export` | Xuất CSV theo cùng bộ lọc; tối đa 50.000 dòng (`413` nếu quá); việc xuất ghi vào `audit_logs` |
| GET | `/api/admin/tags` | Mọi tag (`status=pending\|approved\|rejected`, `q`) |
| POST | `/api/admin/tags` | Manager tạo tag đã duyệt sẵn: `{ "name": "excel" }` |
| POST | `/api/admin/tags/{id}/approve` | Duyệt tag đề xuất |
| POST | `/api/admin/tags/{id}/reject` | Từ chối: `{ "reason": "..." }`; gỡ khỏi các skill đang gắn |
| POST | `/api/admin/tags/merge` | Gộp tag trùng: `{ "from": [3, 7], "into": 2 }` |
| DELETE | `/api/admin/tags/{id}` | Xoá/ẩn tag không còn dùng |

## 10. Ánh xạ trang web với API

| Trang | Endpoint chính |
|---|---|
| Đăng nhập | `/api/auth/login`, `/api/auth/callback` |
| Trang chủ | `/api/skills/featured`, `/api/skills?sort=newest`, `/api/categories` |
| Tìm kiếm | `/api/skills`, `/api/categories`, `/api/departments`, `/api/tags` |
| Chi tiết skill | `/api/skills/{id}`, `/api/skills/{id}/versions`, `/api/skills/{id}/download?intent=zip` |
| Skill của tôi | `/api/installs/me` |
| Tạo / gửi skill | `/api/skills/mine`, `/api/skills`, `…/versions`, `…/submit` |
| Hàng đợi duyệt | `/api/reviews/queue`, `/api/reviews/versions/{id}`, `…/files`, `…/files/content`, `…/decision` |
| Duyệt yêu cầu đổi phạm vi | `/api/reviews/visibility-requests/{id}`, `…/decision` |
| Ảnh biểu tượng trên thẻ | `/api/skills/{id}/icon` |
| Bảng điều khiển quản trị | `/api/admin/dashboard` |
| Phân công duyệt (Manager) | `/api/reviews/queue`, `…/assignment`, `/api/users?role=reviewer` |
| Quản trị | `/api/admin/*`, `/api/users` |
| Chuông thông báo | `/api/notifications` |

## 11. Giới hạn tần suất (đề xuất)

| Nhóm | Giới hạn mỗi người dùng |
|---|---|
| `GET /api/skills*` | 120 request/phút |
| `download` | 30 request/phút |
| `POST /api/skills`, `…/versions`, `…/submit` | 10 request/phút |
| Còn lại | 60 request/phút |

Giá trị cụ thể cấu hình được; vượt giới hạn trả `429` kèm `Retry-After`.
