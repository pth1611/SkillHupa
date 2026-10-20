// Nơi duy nhất giữ màu thương hiệu, tên sản phẩm và logo (D37). Đổi ở đây là đổi cả theme sáng/tối.
export const brand = {
  productName: 'Vita-skill',
  /** Chữ hiển thị cạnh logo khi chưa có file logo. */
  logoText: 'V',
  primary: '#10b981',
  secondary: '#6366f1',
  /** Dải màu nền cho biểu tượng mặc định sinh từ tên skill (skill không có ảnh, D39). */
  avatarPalette: ['#6366f1', '#ec4899', '#0e8a6b', '#f59e0b', '#ef4444', '#3b82f6', '#0f766e', '#8b5cf6'],
} as const
