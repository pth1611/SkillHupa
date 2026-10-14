# Kế hoạch: Skill Marketplace nội bộ

> Trạng thái: **đang lập kế hoạch, chưa viết code.**
> Mỗi bước nhỏ nên làm xong, xem kết quả và được duyệt rồi mới sang bước tiếp theo.

## 1. Mục tiêu

Website nội bộ để nhân viên **tìm, cài và cập nhật skill**. Skill được tạo, duyệt và quản lý theo một quy trình rõ ràng.

Quy trình: Creator tạo skill → Reviewer duyệt → skill được đăng → User tìm, cài và cập nhật.

## 2. Vai trò

| Vai trò | Làm gì |
|---|---|
| **User** | Tìm, cài và cập nhật skill |
| **Creator** | Tạo và gửi skill để duyệt |
| **Reviewer** | Duyệt skill trước khi đăng |
| **Manager** (ưu tiên hàng đầu) | Gỡ skill vi phạm, chuyển quyền sở hữu skill, khôi phục sự cố |

## 3. Các trang và quyền xem theo tài khoản

| Trang | User | Creator | Reviewer | Manager |
|---|---|---|---|---|
| 1. Đăng nhập | ✓ | ✓ | ✓ | ✓ |
| 2. Trang chủ (skill nổi bật, skill mới, danh mục) | ✓ | ✓ | ✓ | ✓ |
| 3. Tìm kiếm và danh mục (lọc theo chủ đề, phòng ban) | ✓ | ✓ | ✓ | ✓ |
| 4. Chi tiết skill (mô tả, hướng dẫn cài, lịch sử phiên bản) | ✓ | ✓ | ✓ | ✓ |
| 5. Skill của tôi (đã cài, cảnh báo có bản cập nhật) | ✓ | ✓ | ✓ | ✓ |
| 6. Tạo và gửi skill | ✗ | ✓ | ✗ | ✗ |
| 7. Hàng đợi duyệt skill | ✗ | ✗ | ✓ | ✗ |
| 8. Trang quản trị | ✗ | ✗ | ✗ | ✓ |

## 4. Cách cài và cập nhật skill

- **CLI:** dùng một dòng lệnh để cài và cập nhật.
- **Tải .zip:** tải gói skill về và tự đặt vào đúng thư mục (cho người không dùng CLI).

## 5. Phong cách thiết kế

Hiện đại, giống kho ứng dụng: thẻ (card) skill, biểu tượng, nhiều màu sắc.

## 6. Các bước thực hiện

### Giai đoạn 0: Chốt yêu cầu
- [ ] 0.1. Đọc lại mục tiêu, vai trò, các trang ở trên và chỉnh sửa nếu cần.
- [ ] 0.2. Trả lời các câu hỏi còn mở (mục 7).
- [ ] 0.3. Chuẩn bị tên website, logo và màu thương hiệu (nếu có).

### Giai đoạn 1: Trang tĩnh đầu tiên (làm quen, chưa có chức năng)
- [ ] 1.1. Tạo `index.html` và `style.css`: tiêu đề, giới thiệu ngắn, nút "Liên hệ".
- [ ] 1.2. Mở trang bằng trình duyệt, kiểm tra trên máy tính và điện thoại.
- [ ] 1.3. Đọc phần giải thích của Claude Code, thử tự đổi chữ, màu và email.

### Giai đoạn 2: Giao diện mẫu (dữ liệu giả, chưa có đăng nhập)
- [ ] 2.1. Trang chủ với các thẻ skill mẫu.
- [ ] 2.2. Trang tìm kiếm và danh mục (bộ lọc chỉ để xem giao diện).
- [ ] 2.3. Trang chi tiết skill với hướng dẫn cài bằng CLI và nút tải .zip.
- [ ] 2.4. Trang "Skill của tôi".
- [ ] 2.5. Duyệt lại toàn bộ giao diện, chốt màu sắc và biểu tượng.

### Giai đoạn 3: Giao diện các trang theo vai trò (vẫn dữ liệu giả)
- [ ] 3.1. Trang tạo và gửi skill (Creator).
- [ ] 3.2. Trang hàng đợi duyệt (Reviewer).
- [ ] 3.3. Trang quản trị: gỡ skill, chuyển quyền sở hữu, khôi phục (Manager).
- [ ] 3.4. Trang đăng nhập.

### Giai đoạn 4: Chức năng thật
- [ ] 4.1. Chọn cách đăng nhập (tài khoản công ty hay tài khoản riêng) và nơi lưu dữ liệu.
- [ ] 4.2. Đăng nhập và phân quyền: mỗi vai trò chỉ thấy đúng các trang của mình.
- [ ] 4.3. Lưu skill thật, tìm kiếm và lọc thật.
- [ ] 4.4. Quy trình gửi → duyệt → đăng.
- [ ] 4.5. Lịch sử phiên bản và cảnh báo có bản cập nhật.
- [ ] 4.6. Quyền của Manager: gỡ skill, chuyển quyền sở hữu, khôi phục về phiên bản trước.

### Giai đoạn 5: Cài đặt và cập nhật skill
- [ ] 5.1. Tải gói .zip cho từng skill.
- [ ] 5.2. Lệnh CLI để cài và cập nhật skill.
- [ ] 5.3. Thử cài thật một skill vào công cụ (ví dụ Claude Code).

### Giai đoạn 6: Kiểm tra và đưa vào sử dụng
- [ ] 6.1. Thử từng vai trò với tài khoản thật, kiểm tra trang nào bị ẩn đúng như bảng ở mục 3.
- [ ] 6.2. Cho một nhóm nhỏ dùng thử và thu phản hồi.
- [ ] 6.3. Sửa lỗi, rồi mở cho toàn công ty.

## 7. Câu hỏi còn mở

- Mỗi người chỉ có một vai trò, hay một tài khoản có thể có nhiều vai trò (ví dụ vừa Creator vừa User)?
- Đăng nhập bằng tài khoản công ty (email/SSO) hay tài khoản riêng của website?
- Website chạy ở đâu (máy chủ của công ty hay dịch vụ bên ngoài)?
- Có màu thương hiệu và logo của công ty không?

## 8. Quy tắc làm việc

- Mỗi lần chỉ làm một bước nhỏ, xong rồi mới sang bước sau.
- Claude Code giải thích bằng tiếng Việt, dễ hiểu, vì người làm không biết lập trình.
- Không cài thêm phần mềm hoặc chạy server khi chưa cần thiết.
